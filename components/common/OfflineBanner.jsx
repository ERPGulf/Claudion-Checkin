/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ICON, LAYOUT, RADIUS, SHADOWS, SPACING, TYPO } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import useOfflineStatus from "../../hooks/useOfflineStatus";
import { describeOfflineStatusForA11y } from "../../utils/offlineStatus";

/**
 * The connectivity pill.
 *
 * A floating status chip rather than a full-bleed bar, because a bar reads as an
 * error state and being offline is not one — the app keeps working, attendance
 * keeps recording, and the only thing that changed is when the server hears
 * about it. Amber, hairline-bordered, sitting on the same status triad
 * (`warningSurface` / `warningBorder` / `warningText`) every other callout in the
 * app uses, so it looks like it was always there.
 *
 * It never blocks anything: the host is `box-none` and the pill itself is
 * `none`, so every touch passes straight through to the screen underneath — a
 * button it happens to overlap is still pressable.
 *
 * **Anchored to the bottom, not the top, and that was measured rather than
 * assumed.** The first build put it below the header band at the top, which is
 * the obvious place; on screens that have a header it landed perfectly. But this
 * navigator's default is `headerShown: false` with modern screens opting in, so
 * the tab screens have no header and their content begins immediately under the
 * safe area. On Home the pill sat straight on top of the employee's name in the
 * welcome card — and being offline is a state that can last hours, so that is
 * not a glance, it is the card being unreadable all morning. There is no gap at
 * the top to sit in, and a global overlay cannot know whether a header exists.
 *
 * Above the tab bar there is always clearance, the content beneath is scrollable
 * rather than fixed, and nothing is occluded that cannot be moved. The trade is
 * that it slides up from the bottom instead of down from the top.
 */

/** Clears the floating tab bar on tab screens; harmless on stack screens. */
const BOTTOM_CLEARANCE = LAYOUT.tabBarContentHeight + SPACING.md;

/** Enter is a touch slower than exit — arriving should be noticed, leaving should not. */
const ENTER_MS = 240;
const EXIT_MS = 180;

/** How far it rises on the way in. Small: this is a settle, not a launch. */
const SLIDE_DISTANCE = 10;

/** One half-cycle of the idle pulse. Calmer than the skeleton's 700ms loader. */
const PULSE_MS = 900;
const PULSE_RANGE = [1, 0.4];

/** One full turn of the sync spinner. */
const SPIN_MS = 1100;

/**
 * Whether the OS has been asked to reduce motion.
 *
 * Only the *looping* animations are dropped when it is on — a continuous spin or
 * pulse is the part that actually causes trouble. The enter/exit transition is
 * brief and one-shot, and removing it entirely makes the banner pop into
 * existence, which is more startling than the motion it replaces.
 */
function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(!!enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

/**
 * The trailing glyph, and whatever it is doing.
 *
 * Split out because its animation is driven by `motion` — a string from the pure
 * status module — and keeping the loops beside the icon they belong to is what
 * stops a spinner outliving the phase that started it.
 */
function TrailingIcon({ name, motion, color, reduceMotion }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (motion !== "pulse" || reduceMotion) return undefined;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [motion, pulse, reduceMotion]);

  useEffect(() => {
    if (motion !== "spin" || reduceMotion) return undefined;

    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [motion, reduceMotion, spin]);

  if (!name) return null;

  const style =
    motion === "pulse" && !reduceMotion
      ? { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: PULSE_RANGE }) }
      : motion === "spin" && !reduceMotion
        ? {
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
            ],
          }
        : null;

  return (
    <Animated.View style={[{ marginStart: SPACING.sm }, style]}>
      <Ionicons name={name} size={ICON.sm} color={color} />
    </Animated.View>
  );
}

function OfflineBanner() {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { visible, content } = useOfflineStatus();

  const progress = useRef(new Animated.Value(0)).current;

  // Kept mounted through the exit animation, then dropped — unmounting on the
  // state change would cut the fade off at frame one.
  const [rendered, setRendered] = useState(visible);

  // The last non-null content, so the words do not blank out mid-fade as the
  // phase clears underneath the animation.
  const contentRef = useRef(content);
  if (content) contentRef.current = content;
  const shown = content ?? contentRef.current;

  useEffect(() => {
    if (visible) setRendered(true);

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? ENTER_MS : EXIT_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });

    return () => animation.stop();
  }, [progress, visible]);

  if (!rendered || !shown) return null;

  const { tone, icon, title, subtitle, trailingIcon, motion } = shown;
  const foreground = colors[`${tone}Text`];

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: insets.bottom + BOTTOM_CLEARANCE,
        left: 0,
        right: 0,
        alignItems: "center",
        paddingHorizontal: SPACING.lg,
      }}
    >
      <Animated.View
        pointerEvents="none"
        accessible
        accessibilityRole={Platform.OS === "ios" ? "text" : "alert"}
        accessibilityLabel={describeOfflineStatusForA11y(shown)}
        // Android announces the change without stealing focus; iOS reads it when
        // the user next lands on it, which is right for a passive status.
        accessibilityLiveRegion="polite"
        style={{
          width: "100%",
          maxWidth: 460,
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: SPACING.sm + 2,
          paddingHorizontal: SPACING.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors[`${tone}Border`],
          backgroundColor: colors[`${tone}Surface`],
          // Lifted off the content it floats over, so it reads as a layer rather
          // than as part of the page. Dropped in dark mode, where a shadow on a
          // dark surface is invisible and the border does the separating.
          ...(isDark ? null : SHADOWS.card),
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [SLIDE_DISTANCE, 0],
              }),
            },
          ],
        }}
      >
        <Ionicons name={icon} size={ICON.md} color={foreground} />

        <View style={{ flex: 1, marginStart: SPACING.sm }}>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.subhead, fontWeight: "600", color: foreground }}
          >
            {title}
          </Text>

          {!!subtitle && (
            <Text
              numberOfLines={2}
              style={{ ...TYPO.caption2, color: foreground, opacity: 0.85 }}
            >
              {subtitle}
            </Text>
          )}
        </View>

        <TrailingIcon
          name={trailingIcon}
          motion={motion}
          color={foreground}
          reduceMotion={reduceMotion}
        />
      </Animated.View>
    </View>
  );
}

export default OfflineBanner;

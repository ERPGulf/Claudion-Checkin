import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  I18nManager,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { useNavigation } from "@react-navigation/native";
import { BUILD_TAG, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useReducedMotion from "../hooks/useReducedMotion";
import ActionButton from "../components/common/ActionButton";
import {
  BrandMark,
  BRAND_MARK_MAX_WIDTH,
  ShimmerField,
} from "../components/Welcome";

/** Entrance timings. Short enough to feel like the screen settling, not a show. */
const RISE_PX = 14;
const HERO_MS = 420;
const CTA_MS = 340;
const CTA_DELAY_MS = 130;

/**
 * The logo's breathing space. It used to also be the halo's bleed — the room a
 * glow parked behind the mark needed to fall off in — but the atmosphere is a
 * full-page field now, so this is just what keeps the lockup from crowding the
 * title.
 */
const MARK_INSET = SPACING.xxxl + SPACING.sm;

/**
 * Blur strength over the field, on expo-blur's 0–100 scale.
 *
 * Mid-range on purpose. The fields underneath are already soft — stacked
 * translucent layers with no hard edge anywhere — so this is not here to hide
 * structure, it is here to melt the three of them into one another and take the
 * last of the contrast out from under the text. Wound up towards 100 the page
 * just goes flat and the motion stops being visible at all, which defeats the
 * point of having it.
 */
const BLUR_INTENSITY = 40;

/**
 * Modern Welcome / Get Started.
 *
 * Presentation only. Still the first screen of the auth stack, still the same
 * `BUILD_TAG`, and the button still does exactly one thing — `navigate("Qrscan")`.
 * No provisioning, storage or startup work lives here; the classic screen had
 * none and neither does this.
 *
 * The composition is a hierarchy rather than three unrelated objects:
 *
 *   0. <ShimmerField> behind everything — soft colour drifting across the whole
 *      page, so the content sits in a lit room rather than on a grey sheet,
 *      with a <BlurView> over it separating the motion from anything readable,
 *   1. the wordmark, with no card behind it in either theme — the brand ships a
 *      light-ink and a dark-ink variant, so <BrandMark> just picks the right one,
 *   2. the title and one two-line subtitle, grouped tight under it,
 *   3. flexible space,
 *   4. the CTA on the standard filled control,
 *   5. the build stamp as a footnote beneath it.
 *
 * No saturated colour of its own anywhere: the atmosphere is the mark's mint and
 * the button is the app's ordinary filled control, so the only brand colour on
 * the page is the one already inside the logo.
 *
 * The copy still promises nothing about features — the app cannot know which
 * modules the tenant enabled until the QR is scanned, so anything more specific
 * would be a claim the next screen can't keep.
 *
 * A <ScrollView> with `flexGrow: 1` rather than a fixed page: at default type it
 * behaves exactly like a flex column (the spacers distribute the slack), and at
 * large accessibility type the spacers collapse and the content scrolls instead
 * of clipping. That is what makes Dynamic Type safe here without capping any
 * string's line count.
 */
function WelcomeScreenModern() {
  const navigation = useNavigation();
  const { colors, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // The mark is the page's anchor, so it scales with the viewport instead of
  // crowding a 320dp screen at a fixed width. There is no panel padding to pay
  // for any more, so the whole width goes to the lockup.
  const markWidth = Math.min(Math.round(width * 0.82), BRAND_MARK_MAX_WIDTH);

  /* ---------- Entrance ---------- */
  /* Core Animated on the native driver — the same primitive <PressableScale>,
     <BottomSheet> and every skeleton in the app already use. Two values, both
     interpolated from one 0→1 progress, so nothing can drift out of step. */
  const progress = useRef(new Animated.Value(0)).current;
  const ctaProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Jump to the settled state. For some people motion is nausea, not polish.
      progress.setValue(1);
      ctaProgress.setValue(1);
      return undefined;
    }

    const animation = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: HERO_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(ctaProgress, {
        toValue: 1,
        duration: CTA_MS,
        delay: CTA_DELAY_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, ctaProgress]);

  const heroStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [RISE_PX, 0],
        }),
      },
    ],
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      {/* Outside the SafeAreaView on purpose: the atmosphere runs under the
          status bar and the gesture bar, because a background that stops at the
          safe area is a panel, not a background. */}
      <ShimmerField />

      {/* ---------- Blur: the layer between the motion and the content ------- */}
      {/* Sits over <ShimmerField> and under everything readable, so the field's
          edges dissolve into one another and the text has calm ground to sit on.

          `expo-blur` is a **native module**, which changes how this screen ships:
          it is a store/EAS build, not an OTA update. An OTA carrying this import
          would crash every install that does not already have the native code, so
          the build has to go out first.

          What each platform actually does here is different, and the difference
          is not a knob this component exposes:

            iOS     — a real frosted blur. UIVisualEffectView samples what is
                      *behind* it in the layer tree, which is exactly the field
                      and nothing else.
            Android — a translucent wash of the tint. There is a real blur
                      available via `experimentalBlurMethod="dimezisBlurView"`,
                      and it is deliberately **not** used: that implementation
                      blurs a snapshot of the entire root view, including the
                      views drawn on top of it, so it paints a blurred copy of the
                      wordmark, the title and the button underneath the crisp
                      ones. Measured on device — every element wore a ghost of
                      itself. There is no way to scope it to the field through
                      this API, and a double-exposed logo is far worse than no
                      blur.

          The wash is not a consolation prize. What a blur buys a layout like this
          is lower contrast under the text, and a translucent layer of the tint
          delivers that on both platforms; iOS just also gets the softening.

          Full-bleed, under the safe area, for the same reason the field is: a
          background treatment that stops at the safe area is a panel. */}
      <BlurView
        intensity={BLUR_INTENSITY}
        tint={isDark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView
        style={{ flex: 1 }}
        edges={["top", "bottom", "left", "right"]}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: SPACING.lg }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Slack above the hero. Collapses first when type grows. */}
          <View style={{ flex: 1, minHeight: SPACING.xl }} />

          {/* ---------- Hero ---------- */}
          <Animated.View style={heroStyle}>
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: MARK_INSET,
              }}
            >
              <BrandMark width={markWidth} />
            </View>

            <View
              style={{
                paddingHorizontal: SPACING.xl,
                marginTop: SPACING.lg,
                alignItems: "center",
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  ...TYPO.title1,
                  color: colors.textPrimary,
                  textAlign: "center",
                }}
              >
                Welcome
              </Text>

              <Text
                style={{
                  ...TYPO.body,
                  color: colors.textSecondary,
                  textAlign: "center",
                  marginTop: SPACING.sm,
                  // Holds the intended two-line shape at default type without
                  // capping the line count, so larger type just wraps further.
                  maxWidth: 300,
                }}
              >
                {"Everything you need for work,\nin one secure place."}
              </Text>
            </View>
          </Animated.View>

          {/* The flexible gap the layout is balanced around. Deliberately the
              smaller share of the slack — an even split left the CTA marooned at
              the bottom of a tall empty band, which is what read as stretched. */}
          <View style={{ flex: 0.72, minHeight: SPACING.xxl }} />

          {/* ---------- CTA + footer ---------- */}
          <Animated.View style={{ opacity: ctaProgress }}>
            <View style={{ paddingVertical: SPACING.xl }}>
              <View style={{ paddingHorizontal: SPACING.xl }}>
                {/* The shared button — the standard filled control as the action
                    itself. The arrow follows the reading direction, so it points
                    forward rather than backwards in an RTL layout. */}
                <ActionButton
                  label="Get Started"
                  icon={I18nManager.isRTL ? "arrow-back" : "arrow-forward"}
                  size="lg"
                  elevated
                  onPress={() => navigation.navigate("Qrscan")}
                />
              </View>
            </View>

            {/* Same OTA build stamp, same source of truth — a footnote under the
                CTA, where a version belongs. Left at `textMuted` rather than
                dimmed further: at 11pt another opacity step would push it under
                the 3:1 floor, and it already recedes on size alone. */}
            <Text
              style={{
                ...TYPO.caption2,
                color: colors.textMuted,
                textAlign: "center",
              }}
            >
              {BUILD_TAG}
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export default WelcomeScreenModern;

/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/** How far down the sheet must be dragged before letting go dismisses it. */
const DISMISS_DISTANCE = 90;

/** …or how fast, for a flick that never travels that far. */
const DISMISS_VELOCITY = 0.6;

const ENTER_MS = 260;
const EXIT_MS = 200;

/**
 * The app's bottom sheet: dimmed backdrop, rounded top corners, a grab handle,
 * a titled header with a close button, and a body slot.
 *
 * Extracted from <ExpenseTypeSheet>, which had all of this inline, so the
 * attachment picker could be built to the same shape instead of a second copy.
 * Everything is themed — a sheet is `cardBackground` on both palettes, never a
 * white panel over a dark page.
 *
 * **Animation.** The Modal's own `animationType` is off and both the backdrop
 * fade and the slide are driven here, for one reason: `visible={false}` unmounts
 * a Modal immediately, which means a sheet given to RN to animate has no exit.
 * `mounted` keeps it rendered until the outward animation finishes, so dismissing
 * is as smooth as opening. Both run on the native driver.
 *
 * **Swipe to dismiss.** A core `PanResponder` on the handle and header rather
 * than react-native-gesture-handler: RNGH needs a `GestureHandlerRootView` around
 * the modal's own tree to receive touches, and this app doesn't mount one.
 * PanResponder needs no setup and is the same core Animated API <PressableScale>
 * already uses. The grab area is the header — dragging the list inside a sheet
 * should scroll it, not close it.
 */
function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  closeLabel = 'Close',
  maxHeightRatio = 0.75,
  children,
}) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Kept mounted through the exit animation; see the note above.
  const [mounted, setMounted] = useState(visible);

  // 0 = fully dismissed (off the bottom), 1 = fully open. The backdrop reads the
  // same value, so the dim can never be out of step with the panel.
  const progress = useRef(new Animated.Value(0)).current;

  // Extra offset contributed by a drag, in points. Separate from `progress` so a
  // release can animate one back without fighting the other.
  const drag = useRef(new Animated.Value(0)).current;

  const animateOut = useCallback(
    (onDone) => {
      Animated.parallel([
        Animated.timing(progress, {
          toValue: 0,
          duration: EXIT_MS,
          useNativeDriver: true,
        }),
        Animated.timing(drag, {
          toValue: 0,
          duration: EXIT_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => finished && onDone?.());
    },
    [progress, drag],
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_MS,
        useNativeDriver: true,
      }).start();
      return;
    }

    animateOut(() => setMounted(false));
  }, [visible, progress, drag, animateOut]);

  // The responder below is created once, so it must not close over a stale
  // handler — it reads the current one through this ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const panResponder = useRef(
    PanResponder.create({
      // Claim the gesture only once it is clearly a downward drag, so a tap on
      // the close button still registers as a tap.
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        // Downward only. Dragging up must not lift the sheet off the bottom
        // edge and expose the backdrop underneath it.
        drag.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldClose =
          gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY;

        if (shouldClose) {
          // Report the dismissal now and let the `visible` change drive the
          // animation, so a swipe and a tap on the close button leave through
          // exactly the same path.
          onCloseRef.current?.();
          return;
        }

        Animated.spring(drag, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 4,
        }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  const maxHeight = windowHeight * maxHeightRatio;

  const translateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      // Far enough that a tall sheet is fully clear of the screen before the
      // fade finishes.
      outputRange: [windowHeight * maxHeightRatio, 0],
    }),
    drag,
  );

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop. Dimmed rather than blurred — a blur would mean adding
          expo-blur, and it degrades to a flat scrim on Android anyway. */}
      <Animated.View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          opacity: progress,
          backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(11,11,20,0.35)',
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityLabel={`${closeLabel} ${title}`}
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* The panel is a sibling of the backdrop, not a child: nesting it would
          make it inherit the backdrop's fading opacity as well as its own. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight,
          transform: [{ translateY }],
        }}
      >
        <View
          style={{
            backgroundColor: colors.cardBackground,
            borderTopStartRadius: RADIUS.xxl,
            borderTopEndRadius: RADIUS.xxl,
            borderTopWidth: 1,
            borderColor: colors.cardBorder,
            paddingBottom: Math.max(insets.bottom, SPACING.lg),
            // Casts upward, over the page the sheet covers.
            ...(isDark ? null : SHADOWS.floating),
          }}
        >
          {/* Grab area: the handle and the header. Dragging here dismisses;
              dragging the body scrolls it. */}
          <View {...panResponder.panHandlers}>
            <View
              accessible
              accessibilityLabel="Swipe down to dismiss"
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: RADIUS.pill,
                backgroundColor: colors.cardBorder,
                marginTop: SPACING.md,
                marginBottom: SPACING.sm,
              }}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                paddingHorizontal: SPACING.lg,
                paddingBottom: SPACING.md,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, paddingEnd: SPACING.sm }}>
                <Text
                  accessibilityRole="header"
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  {title}
                </Text>
                {!!subtitle && (
                  <Text
                    style={{
                      ...TYPO.subhead,
                      fontWeight: '400',
                      color: colors.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    {subtitle}
                  </Text>
                )}
              </View>

              {/* Top-right, not a full-width Cancel at the bottom: the bottom of
                  a sheet is where the last option lives, and a button there gets
                  hit by accident. */}
              <PressableScale
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: RADIUS.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.iconBackground,
                }}
              >
                <Ionicons
                  name="close"
                  size={ICON.sm}
                  color={colors.textSecondary}
                />
              </PressableScale>
            </View>

            <View style={{ height: 1, backgroundColor: colors.dividerSubtle }} />
          </View>

          {children}
        </View>
      </Animated.View>
    </Modal>
  );
}

export default BottomSheet;

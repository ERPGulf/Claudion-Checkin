/* eslint-disable react/prop-types */
import React, { useCallback, useRef } from 'react';
import { Animated, Pressable } from 'react-native';

/**
 * Base tappable for the app: everything a user can press scales down slightly
 * and dims on press-in. Uses the core `Animated` API (no worklets) so it costs
 * nothing at startup and behaves identically on both platforms.
 *
 * `style` lands on the pressable itself — not on a wrapper — so percentage
 * widths and flex still resolve against the real parent when this is used as a
 * grid item.
 *
 * Props: `scaleTo`, `activeOpacity`, plus every Pressable prop.
 * Always pass `accessibilityLabel` when the children are icon-only.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  activeOpacity = 0.9,
  disabled,
  hitSlop = 8,
  // Defaulted here, not before `{...rest}`: a caller passing an explicit
  // `undefined` (FeatureTile does) would otherwise strip the button role.
  accessibilityRole = 'button',
  ...rest
}) {
  const progress = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    to => {
      Animated.spring(progress, {
        toValue: to,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }).start();
    },
    [progress],
  );

  const animatedStyle = {
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, scaleTo],
        }),
      },
    ],
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, activeOpacity],
    }),
  };

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => animate(1)}
      onPressOut={() => animate(0)}
      // Always animated: a button that turns disabled (loading) on tap springs
      // back from its pressed state instead of snapping. A disabled Pressable
      // never fires onPressIn, so at rest this is scale 1.
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

export default PressableScale;

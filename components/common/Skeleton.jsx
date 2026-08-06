/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { RADIUS } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/** One half-cycle of the pulse. */
const PULSE_MS = 700;

/** Opacity range. Never fully transparent — a block that vanishes reads as a bug. */
const PULSE_RANGE = [1, 0.45];

/**
 * The app's loading pulse: a plain opacity loop on the core Animated API — no
 * worklets, no gradient library — running on the native driver, so it costs
 * nothing while a request is in flight.
 *
 * Extracted because this exact loop was written out in full by every skeleton in
 * the app (attendance history, expense claims, document details, and now
 * notifications). Four copies of one timing curve is how a loading state ends up
 * pulsing at a different speed on one screen than the next.
 *
 * Returns the interpolated opacity, ready to spread onto an <Animated.View>.
 */
export function useSkeletonPulse() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return pulse.interpolate({ inputRange: [0, 1], outputRange: PULSE_RANGE });
}

/**
 * One placeholder block on the skeleton palette.
 *
 * `opacity` comes from `useSkeletonPulse()` — passed in rather than created here,
 * so every block in one skeleton breathes in step instead of each running its own
 * loop. `circle` is for round chrome (an avatar, a status dot); otherwise the
 * corner radius is the caller's, defaulting to the small one text blocks use.
 */
export function SkeletonBlock({
  width,
  height,
  radius = RADIUS.sm,
  circle = false,
  opacity,
  style,
}) {
  const { colors } = useAppTheme();

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: circle ? (Number(height) || 0) / 2 : radius,
          backgroundColor: colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

export default SkeletonBlock;

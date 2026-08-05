/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * Loading placeholder for the history list, shaped like the real cards — same
 * 40pt glyph, same header row, same amount block — so nothing jumps when the
 * claims arrive.
 *
 * This replaces the classic screen's full-page spinner, which blanked the form
 * as well. The form doesn't depend on the claims query, so the modern screen
 * renders it immediately and only the history section waits.
 *
 * The pulse is a plain opacity loop on the core Animated API (no worklets, no
 * gradient library) running on the native driver, so it costs nothing while the
 * request is in flight.
 */
function ExpenseSkeleton({ count = 2 }) {
  const { colors } = useAppTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.45],
  });

  const block = (width, height) => (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: RADIUS.sm,
        backgroundColor: colors.skeleton,
        opacity,
      }}
    />
  );

  return (
    <View accessible accessibilityLabel="Loading expense claims">
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={`claim-skeleton-${index}`}
          style={{
            backgroundColor: colors.cardBackground,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            padding: SPACING.md,
            marginBottom: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.View
              style={{
                width: 40,
                height: 40,
                borderRadius: RADIUS.md,
                backgroundColor: colors.skeleton,
                opacity,
              }}
            />
            <View style={{ flex: 1, marginStart: SPACING.md }}>
              {block('45%', 12)}
              <View style={{ height: SPACING.xs }} />
              {block('30%', 10)}
            </View>
            {block(64, 18)}
          </View>

          <View style={{ marginTop: SPACING.md }}>{block('38%', 24)}</View>
        </View>
      ))}
    </View>
  );
}

export default ExpenseSkeleton;

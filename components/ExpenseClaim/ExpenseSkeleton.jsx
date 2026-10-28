/* eslint-disable react/prop-types */
import React from 'react';
import { Animated, View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { useSkeletonPulse } from '../common/Skeleton';

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
 * gradient library) using the shared native-driver pulse and reduced-motion
 * preference.
 */
function ExpenseSkeleton({ count = 2, label = 'Loading expense claims' }) {
  const { colors } = useAppTheme();
  const opacity = useSkeletonPulse();

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
    <View accessible accessibilityLabel={label}>
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

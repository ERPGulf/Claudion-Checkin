/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { SkeletonBlock, useSkeletonPulse } from '../common/Skeleton';

/**
 * Loading placeholder shaped like the real list — a date pill, then rows with the
 * same 40pt round chip and the same two text lines — so nothing jumps when the
 * notifications arrive.
 *
 * This is what the classic screen never had: with no loading flag, an empty list
 * and a list still in flight both rendered "No notifications", so a slow request
 * looked like an empty inbox.
 *
 * The pulse comes from the shared `useSkeletonPulse`, so every block here
 * breathes in step and at the same rate as the skeletons on the other screens.
 */
function NotificationSkeleton({ groups = 2, rowsPerGroup = 3 }) {
  const { colors } = useAppTheme();
  const opacity = useSkeletonPulse();

  return (
    <View accessible accessibilityLabel="Loading notifications">
      {Array.from({ length: groups }).map((_, groupIndex) => (
        <View key={`notification-skeleton-group-${groupIndex}`}>
          <SkeletonBlock
            width={88}
            height={18}
            radius={RADIUS.pill}
            opacity={opacity}
            style={{
              marginStart: SPACING.lg,
              marginTop: groupIndex === 0 ? SPACING.md : SPACING.xl,
              marginBottom: SPACING.sm,
            }}
          />

          <View
            style={{
              marginHorizontal: SPACING.lg,
              borderRadius: RADIUS.xl,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              backgroundColor: colors.cardBackground,
            }}
          >
            {Array.from({ length: rowsPerGroup }).map((__, rowIndex) => (
              <View key={`notification-skeleton-row-${rowIndex}`}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: SPACING.md,
                  }}
                >
                  <SkeletonBlock
                    width={40}
                    height={40}
                    circle
                    opacity={opacity}
                  />

                  <View style={{ flex: 1, marginStart: SPACING.md }}>
                    <SkeletonBlock width="55%" height={12} opacity={opacity} />
                    <View style={{ height: SPACING.xs }} />
                    <SkeletonBlock width="85%" height={10} opacity={opacity} />
                  </View>

                  <SkeletonBlock
                    width={34}
                    height={10}
                    opacity={opacity}
                    style={{ marginStart: SPACING.sm }}
                  />
                </View>

                {rowIndex < rowsPerGroup - 1 && (
                  <View
                    style={{
                      height: 1,
                      marginStart: SPACING.md + 40 + SPACING.md,
                      backgroundColor: colors.dividerSubtle,
                    }}
                  />
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export default NotificationSkeleton;

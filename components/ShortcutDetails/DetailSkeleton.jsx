import { t, useTranslation } from "../../localization";
/* eslint-disable react/prop-types */
import React from 'react';
import { Animated, View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { useSkeletonPulse } from '../common/Skeleton';

/**
 * Loading placeholder shaped like the real detail page — a hero block, then a
 * card of rows with the same 36pt chip and row height — so nothing jumps when
 * the document arrives.
 *
 * Replaces a centred spinner on an otherwise blank screen. The pulse is a plain
 * opacity loop on the core Animated API, using the shared native-driver pulse
 * and reduced-motion preference.
 */
function DetailSkeleton({ rows = 5 }) {
  useTranslation();
  const { colors } = useAppTheme();
  const opacity = useSkeletonPulse();

  const block = (width, height, extra) => (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: RADIUS.sm,
        backgroundColor: colors.skeleton,
        opacity,
        ...extra,
      }}
    />
  );

  const surface = {
    backgroundColor: colors.cardBackground,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  };

  return (
    <View accessible accessibilityLabel={t("Loading details")}>
      {/* Hero */}
      <View
        style={{ ...surface, padding: SPACING.lg, marginBottom: SPACING.md }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Animated.View
            style={{
              width: 44,
              height: 44,
              borderRadius: RADIUS.md,
              backgroundColor: colors.skeleton,
              opacity,
            }}
          />
          <View style={{ flex: 1, marginStart: SPACING.md }}>
            {block('55%', 15)}
            <View style={{ height: SPACING.xs }} />
            {block('38%', 11)}
          </View>
        </View>
      </View>

      {/* Rows */}
      <View style={surface}>
        {Array.from({ length: rows }).map((_, index) => (
          <View key={`detail-skeleton-${index}`}>
            {index > 0 && (
              <View
                style={{
                  height: 1,
                  marginStart: SPACING.lg + 36 + SPACING.md,
                  backgroundColor: colors.dividerSubtle,
                }}
              />
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                paddingHorizontal: SPACING.lg,
              }}
            >
              <Animated.View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: RADIUS.md,
                  backgroundColor: colors.skeleton,
                  opacity,
                }}
              />
              <View style={{ marginStart: SPACING.md }}>{block(90, 12)}</View>
              <View style={{ flex: 1 }} />
              {block(70, 13)}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default DetailSkeleton;

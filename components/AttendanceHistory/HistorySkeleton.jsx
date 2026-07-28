/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * Loading placeholder that mirrors the real list's geometry — same 40pt glyph,
 * same two text columns, same row height — so the content doesn't jump when it
 * arrives. Replaces a centred spinner on an otherwise empty screen.
 *
 * The pulse is a plain opacity loop on the core Animated API (no worklets, no
 * gradient library) and runs on the native driver, so it costs nothing while the
 * request is in flight.
 */
function SkeletonRow({ isFirst, isLast, opacity, colors }) {
  return (
    <View
      style={{
        backgroundColor: colors.cardBackground,
        // Corners per row rather than `overflow: 'hidden'` on the group — Android
        // clips to the bounding rect, which would square these off.
        borderTopStartRadius: isFirst ? RADIUS.xl : 0,
        borderTopEndRadius: isFirst ? RADIUS.xl : 0,
        borderBottomStartRadius: isLast ? RADIUS.xl : 0,
        borderBottomEndRadius: isLast ? RADIUS.xl : 0,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SPACING.lg,
          paddingVertical: 14,
        }}
      >
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
          <Animated.View
            style={{
              width: '55%',
              height: 12,
              borderRadius: RADIUS.sm,
              backgroundColor: colors.skeleton,
              opacity,
            }}
          />
        </View>
        <Animated.View
          style={{
            width: 62,
            height: 14,
            borderRadius: RADIUS.sm,
            backgroundColor: colors.skeleton,
            opacity,
          }}
        />
      </View>

      {!isLast && (
        <View
          style={{
            height: 1,
            backgroundColor: colors.dividerSubtle,
            marginStart: SPACING.lg + 40 + SPACING.md,
          }}
        />
      )}
    </View>
  );
}

function HistorySkeleton({ groups = 2, rowsPerGroup = 3 }) {
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

  return (
    <View
      accessible
      accessibilityLabel="Loading attendance history"
      style={{ paddingHorizontal: SPACING.lg }}
    >
      {Array.from({ length: groups }).map((_, groupIndex) => (
        <View key={`group-${groupIndex}`}>
          <Animated.View
            style={{
              width: 96,
              height: 13,
              borderRadius: RADIUS.sm,
              backgroundColor: colors.skeleton,
              opacity,
              marginTop: groupIndex === 0 ? SPACING.xl : SPACING.xxl,
              marginBottom: SPACING.md,
            }}
          />
          <View
            style={{
              borderRadius: RADIUS.xl,
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            {Array.from({ length: rowsPerGroup }).map((__, rowIndex) => (
              <SkeletonRow
                key={`row-${rowIndex}`}
                isFirst={rowIndex === 0}
                isLast={rowIndex === rowsPerGroup - 1}
                opacity={opacity}
                colors={colors}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export default HistorySkeleton;

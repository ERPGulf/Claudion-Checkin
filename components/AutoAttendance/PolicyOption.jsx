/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';

/**
 * A selection row for the policy simulator: title, supporting line, and a
 * trailing indicator.
 *
 * Close cousin of <ReasonOption> on Attendance Request, but not the same
 * component — that one is a single-line label with no description, and widening
 * it to carry one would have meant changing a shipped screen to serve this one.
 *
 * `accessibilityRole="radio"` because the three policies are mutually exclusive.
 * The indicator fills with `buttonFill` rather than the brand orange: a white
 * glyph on #F87627 lands at 2.9:1, under the 3:1 WCAG floor for non-text
 * contrast.
 */
function PolicyOption({
  title,
  description,
  selected,
  onPress,
  showDivider = false,
}) {
  const { colors } = useAppTheme();

  // Transform/opacity only, so the tick can run on the native driver.
  const tick = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(tick, {
      toValue: selected ? 1 : 0,
      useNativeDriver: true,
      speed: 26,
      bounciness: 6,
    }).start();
  }, [selected, tick]);

  return (
    <>
      <PressableScale
        onPress={onPress}
        scaleTo={0.99}
        hitSlop={0}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={title}
        accessibilityHint={description}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          paddingVertical: SPACING.sm,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, marginEnd: SPACING.md }}>
          <Text
            style={{
              ...TYPO.body,
              fontWeight: selected ? '600' : '400',
              color: colors.textPrimary,
            }}
          >
            {title}
          </Text>
          {!!description && (
            <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
              {description}
            </Text>
          )}
        </View>

        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: RADIUS.pill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: selected ? 0 : 1,
            borderColor: colors.cardBorder,
            backgroundColor: selected ? colors.buttonFill : 'transparent',
          }}
        >
          <Animated.View style={{ opacity: tick, transform: [{ scale: tick }] }}>
            <Ionicons
              name="checkmark"
              size={ICON.sm}
              color={colors.buttonFillText}
            />
          </Animated.View>
        </View>
      </PressableScale>

      {showDivider && (
        <View style={{ height: 1, backgroundColor: colors.dividerSubtle }} />
      )}
    </>
  );
}

export default PolicyOption;

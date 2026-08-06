/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';

/** Row height. 46 clears the 44pt target with nothing to spare on the eye. */
export const REASON_ROW_HEIGHT = 46;

/**
 * A selectable row for the reason list — Settings-style rather than a bordered
 * option card: no fill, no border, hairline separators between rows. Two of
 * these now cost what one card used to.
 *
 * `accessibilityRole="radio"` rather than "checkbox": the underlying state is a
 * single string, so picking one reason replaces the other. The classic screen
 * drew checkboxes for that same single-select state, which told screen readers
 * the wrong thing — the behaviour here is identical, only the announcement is
 * now correct.
 *
 * Selection is carried by three things at once — accent glyph, weighted label
 * and a filled tick — because with the card tint gone, a single cue would be too
 * quiet. The tick fills with `buttonFill` (near-black on light, near-white on
 * dark) instead of the brand accent: a white glyph on the old orange #F87627
 * landed at 2.9:1,
 * under the 3:1 WCAG floor for non-text contrast.
 */
function ReasonOption({ label, icon, selected, onPress, showDivider = false }) {
  const { colors } = useAppTheme();

  // Only the tick is animated, and only on transform/opacity, so it can run on
  // the native driver. Colours switch instantly — animating one would force the
  // JS driver for a change nobody perceives as motion.
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
        accessibilityLabel={label}
        style={{
          minHeight: REASON_ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Ionicons
          name={icon}
          size={ICON.md}
          color={selected ? colors.accentText : colors.textSecondary}
          style={{ marginEnd: SPACING.md }}
        />

        <Text
          style={{
            ...TYPO.body,
            fontWeight: selected ? '600' : '400',
            color: colors.textPrimary,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>

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
            marginStart: SPACING.sm,
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

export default ReasonOption;

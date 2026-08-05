/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * Horizontal chrome inside the field: both paddings, the glyph and the chevron
 * with their equal gutters. Exported so the screen can work out whether a value
 * still fits in a two-column row, instead of guessing with a breakpoint.
 *
 * The glyph is a bare icon rather than a 32dp chip. A chip costs 44dp on the
 * value's line, which pushes a date past the available width on every phone and
 * forces the grid to stack — so the chip would cost roughly two thirds of the
 * screen's vertical saving to buy nothing the icon doesn't already say.
 */
export const FIELD_CHROME_WIDTH =
  SPACING.md * 2 + ICON.sm + SPACING.sm + ICON.sm + SPACING.sm;

/**
 * Room a value needs before pairing two fields in a row is worth it.
 * "5 Aug 2026" is the longest string these fields render, ~82dp at the default
 * font scale.
 */
export const MIN_VALUE_WIDTH = 84;

/** One line of value plus padding. Comfortably past the 44pt target. */
export const FIELD_HEIGHT = 56;

/**
 * Whether two fields still fit side by side at this window width.
 *
 * Measured rather than pinned to a device breakpoint: take the window, subtract
 * the screen margins and the card's own padding, halve what's left, then take
 * off the field's chrome. Lives here because the field owns those numbers — if
 * its padding changes, the answer follows instead of going stale.
 *
 * Works out to ~384dp. Phones at 390dp and up pair; a 360dp device stacks rather
 * than truncate a date, which is the trade the label-above layout costs.
 */
export function fitsTwoColumns(windowWidth) {
  const cardInnerWidth = windowWidth - SPACING.lg * 2 - SPACING.md * 2;
  const columnWidth = (cardInnerWidth - SPACING.sm) / 2;
  return columnWidth - FIELD_CHROME_WIDTH >= MIN_VALUE_WIDTH;
}

/**
 * One tappable field that reads a date or a time. `icon` is what makes it a
 * calendar or a clock — a single component rather than a DateInput/TimeInput
 * pair, so the two can never drift apart visually.
 *
 * Presentation only. It renders whatever string it is handed and reports the
 * press; the DateTimePicker, its value and its `onChange` stay on the screen,
 * so how a date gets selected is untouched. The whole row is the target — there
 * is no smaller hit area on the glyph or the chevron.
 *
 * Layout: label above, then a single centred row of glyph, value and chevron.
 * The value takes everything left over and truncates at one line, so it cannot
 * wrap. The glyph's trailing gutter and the chevron's leading gutter are the
 * same, which is what keeps the row optically even.
 *
 * `active` is the focus state — true while this field's picker is open. It reads
 * as focus, not as a warning: the border steps up to the primary text colour,
 * the surface lifts from recessed to the card colour, and a soft shadow comes in
 * (light mode only, since a shadow over a near-black page is invisible — the
 * same rule <Card> follows). `borderWidth` never changes, so nothing reflows.
 *
 * `placeholder` covers fields that start empty — an expense date is not chosen
 * for you the way a request's From date is. It renders in the muted colour so an
 * unset field is distinguishable from a set one at a glance. Callers that always
 * pass a value never see it.
 */
function PickerField({
  label,
  value,
  placeholder,
  icon,
  onPress,
  active = false,
  invalid = false,
  style,
}) {
  const { colors, isDark } = useAppTheme();

  const empty = !value;
  const display = empty ? placeholder : value;

  // Error stays a distinct signal now that focus no longer borrows the accent.
  const borderColor = invalid
    ? colors.errorBorder
    : active
      ? colors.textPrimary
      : colors.cardBorder;

  return (
    // `minWidth: 0` lets the cell shrink below its content inside a row, which
    // is what allows the value to truncate instead of forcing the row wider.
    <View style={[{ minWidth: 0 }, style]}>
      <Text
        style={{
          ...TYPO.caption,
          color: colors.textSecondary,
          marginBottom: SPACING.xs,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>

      <PressableScale
        onPress={onPress}
        scaleTo={0.98}
        hitSlop={0}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${display}`}
        accessibilityHint="Opens a picker"
        style={{
          // minHeight, not height — the row grows under a large font scale
          // rather than clipping.
          minHeight: FIELD_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SPACING.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor,
          backgroundColor: active
            ? colors.cardBackground
            : colors.surfaceSecondary,
          ...(active && !isDark ? SHADOWS.card : null),
        }}
      >
        <Ionicons
          name={icon}
          size={ICON.sm}
          color={active ? colors.textPrimary : colors.textMuted}
          style={{ marginEnd: SPACING.sm }}
        />

        <Text
          style={{
            ...TYPO.body,
            color: empty ? colors.textMuted : colors.textPrimary,
            flex: 1,
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {display}
        </Text>

        {/* Down, not forward: this opens a picker in place rather than pushing a
            screen. It also needs no RTL flip. */}
        <Ionicons
          name="chevron-down"
          size={ICON.sm}
          color={colors.textMuted}
          style={{ marginStart: SPACING.sm }}
        />
      </PressableScale>
    </View>
  );
}

export default PickerField;

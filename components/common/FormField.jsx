/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { resolveTextAlign } from '../../utils/textDirection';
import { COMPACT_FIELD_HEIGHT, FIELD_HEIGHT } from './PickerField';

/**
 * Lines a multiline box starts at. Three is what Expense Claims and Leave
 * Application ship with, so it is also what `minLines` defaults to — a caller
 * asking for more (Complaints wants four) grows the box by whole lines of body
 * type from there, and the existing callers keep the exact height they had.
 */
const BASE_MULTILINE_LINES = 3;

/**
 * A text field built to the same spec as <PickerField>, so a typed value and a
 * picked one sit on the same grid: label above in caption/secondary, then a
 * 56pt rounded container with the same radius, the same hairline, the same
 * recessed fill and the same focus treatment — border to the primary text
 * colour, surface lifting to the card colour, soft shadow in light mode only.
 *
 * `multiline` swaps the fixed row for a growing box and pins the glyph and the
 * text to the top, since a centred glyph beside three lines of description reads
 * as floating. `minLines` sets how tall that box starts — it is a floor, so the
 * field still grows line by line as the user types and never scrolls internally.
 * `align="right"` is for figures: an amount lines up on its last digit and
 * renders tabular, so a column of them is comparable. `align="auto"` follows the
 * script of the text actually typed, so an Arabic paragraph reads from the right
 * without forcing every field on the screen to flip.
 *
 * `compact` is the denser rhythm shared with <PickerField>: a 48pt row rather
 * than 56, and a multiline box that starts at three lines rather than four. It
 * is opt-in, so Expense Claims keeps the size it ships at today.
 *
 * Presentation only — it owns nothing but its own focus flag. The value, the
 * keyboard type and the change handler all come from useExpenseClaimForm, so
 * this renders exactly what the classic form's <TextInput> would have.
 */
function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType,
  multiline = false,
  minLines = BASE_MULTILINE_LINES,
  invalid = false,
  optional = false,
  compact = false,
  align = 'left',
  accessibilityLabel,
  accessibilityHint,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const [focused, setFocused] = useState(false);

  // Whole extra lines of body type beyond the three the box is built around, so
  // the container and the input grow together and stay in step.
  const extraHeight =
    Math.max(0, Math.round(minLines) - BASE_MULTILINE_LINES) *
    TYPO.body.lineHeight;

  const textAlign = align === 'auto' ? resolveTextAlign(value) : align;

  const borderColor = invalid
    ? colors.errorBorder
    : focused
      ? colors.textPrimary
      : colors.cardBorder;

  return (
    <View style={[{ minWidth: 0 }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: compact ? 2 : SPACING.xs,
        }}
      >
        <Text
          style={{ ...TYPO.caption, color: colors.textSecondary, flex: 1 }}
          numberOfLines={1}
        >
          {label}
        </Text>

        {optional && (
          <Text style={{ ...TYPO.caption2, color: colors.textMuted }}>
            Optional
          </Text>
        )}
      </View>

      <View
        style={{
          // minHeight, not height — the box grows under a large font scale
          // rather than clipping.
          // `minLines` lines of body type plus padding when multiline, one row
          // otherwise. It grows past this as the user types — `minHeight` is a
          // floor, not a cap.
          minHeight: multiline
            ? (compact ? 84 : 92) + extraHeight
            : (compact ? COMPACT_FIELD_HEIGHT : FIELD_HEIGHT),
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          paddingHorizontal: compact ? SPACING.sm : SPACING.md,
          paddingVertical: multiline ? (compact ? SPACING.sm : SPACING.md) : 0,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor,
          backgroundColor: focused
            ? colors.cardBackground
            : colors.surfaceSecondary,
          ...(focused && !isDark ? SHADOWS.card : null),
        }}
      >
        {!!icon && (
          <Ionicons
            name={icon}
            size={ICON.sm}
            color={focused ? colors.textPrimary : colors.textMuted}
            style={{
              marginEnd: compact ? 6 : SPACING.sm,
              // Sits on the first line's optical centre rather than the middle
              // of a three-line box.
              marginTop: multiline ? 2 : 0,
            }}
          />
        )}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={accessibilityLabel || label}
          accessibilityHint={accessibilityHint}
          style={{
            ...TYPO.body,
            flex: 1,
            color: colors.textPrimary,
            textAlign,
            // A tabular amount lines up digit for digit with the figures in the
            // history cards below it.
            ...(align === 'right'
              ? { fontVariant: ['tabular-nums'], ...TYPO.title3 }
              : null),
            // Android adds the font's own ascent/descent on top of the line box,
            // which pushes a single-line value off centre in a fixed-height row.
            includeFontPadding: false,
            textAlignVertical: multiline ? 'top' : 'center',
            // A multiline box grows from `minLines` lines; a single-line field
            // must not inherit that height.
            ...(multiline
              ? { minHeight: (compact ? 63 : 64) + extraHeight }
              : null),
            paddingVertical: 0,
          }}
        />
      </View>
    </View>
  );
}

export default FormField;

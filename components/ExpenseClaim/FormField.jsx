/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { FIELD_HEIGHT } from '../common/PickerField';

/**
 * A text field built to the same spec as <PickerField>, so a typed value and a
 * picked one sit on the same grid: label above in caption/secondary, then a
 * 56pt rounded container with the same radius, the same hairline, the same
 * recessed fill and the same focus treatment — border to the primary text
 * colour, surface lifting to the card colour, soft shadow in light mode only.
 *
 * `multiline` swaps the fixed row for a growing box and pins the glyph and the
 * text to the top, since a centred glyph beside three lines of description reads
 * as floating. `align="right"` is for figures: an amount lines up on its last
 * digit and renders tabular, so a column of them is comparable.
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
  invalid = false,
  optional = false,
  align = 'left',
  accessibilityLabel,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const [focused, setFocused] = useState(false);

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
          marginBottom: SPACING.xs,
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
          minHeight: multiline ? 92 : FIELD_HEIGHT,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          paddingHorizontal: SPACING.md,
          paddingVertical: multiline ? SPACING.md : 0,
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
              marginEnd: SPACING.sm,
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
          style={{
            ...TYPO.body,
            flex: 1,
            color: colors.textPrimary,
            textAlign: align,
            // A tabular amount lines up digit for digit with the figures in the
            // history cards below it.
            ...(align === 'right'
              ? { fontVariant: ['tabular-nums'], ...TYPO.title3 }
              : null),
            // Android adds the font's own ascent/descent on top of the line box,
            // which pushes a single-line value off centre in a fixed-height row.
            includeFontPadding: false,
            textAlignVertical: multiline ? 'top' : 'center',
            // A multiline box grows from three lines; a single-line field must
            // not inherit that height.
            ...(multiline ? { minHeight: 64 } : null),
            paddingVertical: 0,
          }}
        />
      </View>
    </View>
  );
}

export default FormField;

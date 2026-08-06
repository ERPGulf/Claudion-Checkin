/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { resolveTextAlign } from '../../utils/textDirection';
import PressableScale from './PressableScale';
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
 * colour and surface lifting to the card colour. No shadow on focus: see the
 * note at the container for the bug that cost.
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
 * Three additions came from the modern Login screen, all opt-in so every existing
 * caller renders byte-identically without them:
 *
 * - `secureTextEntry` turns the field into a password box **and** gives it the
 *   reveal toggle, rather than leaving each screen to bolt its own eye button on
 *   the side. It is the same Ionicons `eye`/`eye-off` pair the classic login used,
 *   at the shared ICON size and inside a <PressableScale> so it answers a tap the
 *   way every other control in the app does. Keeping it in here is the whole
 *   point: a password field that looked like the other fields but had a
 *   hand-built trailing button would drift the moment either changed.
 * - `errorText` renders the message under the field and implies `invalid`, so a
 *   caller passes the string and gets the red border with it. It is announced as
 *   a live region — a validation message no screen reader mentions is decoration.
 * - `disabled` greys the field and stops editing, for a form that is mid-submit.
 *
 * Presentation only — it owns nothing but its own focus and reveal flags. The
 * value, the keyboard type and the change handler all come from the caller's
 * hook, so this renders exactly what the classic form's <TextInput> would have.
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
  secureTextEntry = false,
  errorText,
  disabled = false,
  autoFocus = false,
  returnKeyType,
  onSubmitEditing,
  onBlur,
  textContentType,
  autoComplete,
  autoCapitalize,
  accessibilityLabel,
  accessibilityHint,
  style,
}) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // A message is a failure; a caller should not have to say so twice.
  const isInvalid = invalid || !!errorText;

  // Whole extra lines of body type beyond the three the box is built around, so
  // the container and the input grow together and stay in step.
  const extraHeight =
    Math.max(0, Math.round(minLines) - BASE_MULTILINE_LINES) *
    TYPO.body.lineHeight;

  const textAlign = align === 'auto' ? resolveTextAlign(value) : align;

  const borderColor = isInvalid
    ? colors.errorBorder
    : focused
      ? colors.textPrimary
      : colors.cardBorder;

  // A disabled field drops to the neutral chip colour and loses the focus lift,
  // so it reads as "not yours to type in" rather than as an empty field.
  const fill = disabled
    ? colors.iconBackground
    : focused
      ? colors.cardBackground
      : colors.surfaceSecondary;

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
          backgroundColor: fill,
          // **No shadow on focus, on either platform.** This used to add
          // `SHADOWS.card` here, and that is what stopped the field being
          // typeable: adding a shadow to the container of a focused input blurs
          // it the instant it focuses, so the keyboard opens and shuts again and
          // no character ever lands.
          //
          // Measured on both, because they present as unrelated bugs:
          //   Android — the field focused (`onStartInput`, password IME) and was
          //             blurred in the same beat (`onFinishInputView`). The
          //             classic screen's plain field, which has no focus state at
          //             all, held focus — which is what isolated it to here.
          //   iOS     — an `autoFocus`ed field rendered already blurred and
          //             errored, with no caret. Dropping the shadow gave it a
          //             caret and it held focus.
          //
          // Gating this to iOS was the first attempt and was only half a fix —
          // the shadow is the problem, not Android `elevation` specifically.
          // Nothing is lost: the focus affordance is the border going to
          // `textPrimary` and the fill lifting to the card colour, which are the
          // two signals that do not break the control they decorate.
        }}
      >
        {!!icon && (
          <Ionicons
            name={icon}
            size={ICON.sm}
            color={focused && !disabled ? colors.textPrimary : colors.textMuted}
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
          editable={!disabled}
          secureTextEntry={secureTextEntry && !revealed}
          autoFocus={autoFocus}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          textContentType={textContentType}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          onFocus={() => setFocused(true)}
          // The caller's handler still runs — Formik marks the field touched on
          // blur, and swallowing it here would silence every validation message.
          onBlur={event => {
            setFocused(false);
            onBlur?.(event);
          }}
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

        {secureTextEntry && (
          <PressableScale
            onPress={() => setRevealed(previous => !previous)}
            disabled={disabled}
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            // The glyph is 16pt; the target around it is not. Without this the
            // reveal toggle is the smallest tap target on the screen.
            hitSlop={SPACING.md}
            style={{ marginStart: SPACING.sm }}
          >
            <Ionicons
              name={revealed ? 'eye-off' : 'eye'}
              size={ICON.md}
              color={disabled ? colors.textMuted : colors.textSecondary}
            />
          </PressableScale>
        )}
      </View>

      {!!errorText && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            ...TYPO.caption,
            color: colors.errorText,
            marginTop: SPACING.xs,
          }}
        >
          {errorText}
        </Text>
      )}
    </View>
  );
}

export default FormField;

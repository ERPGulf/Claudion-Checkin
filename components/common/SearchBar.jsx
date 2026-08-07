/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';
import { resolveTextAlign } from '../../utils/textDirection';

/** One line of input plus padding, comfortably past the 44pt touch target. */
export const SEARCH_BAR_HEIGHT = 44;

/**
 * The app's search input.
 *
 * Built to the same spec as <PickerField> and <FormField> — same radius, same
 * hairline, same recessed fill, and the same focus treatment where the border
 * steps up to the primary text colour and the surface lifts to the card colour.
 * A search field that looked like its own thing would be the one control on the
 * screen that came from somewhere else.
 *
 * The clear button appears only when there is something to clear, so an empty
 * field is a plain prompt rather than a control with a dead affordance. It is a
 * separate 28pt target inside the bar, which is why the bar itself is not
 * pressable — tapping the field focuses it, tapping the cross empties it, and
 * the two never fight.
 *
 * `count` renders a tally on the right ("3 of 42"), for callers that filter a
 * known total. It sits outside the field, so it never crowds the text.
 */
function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
  accessibilityLabel = 'Search',
  onSubmitEditing,
  autoFocus = false,
  style,
}) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);

  const hasQuery = !!value;

  return (
    <View
      style={[
        {
          minHeight: SEARCH_BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SPACING.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: focused ? colors.textPrimary : colors.cardBorder,
          backgroundColor: focused
            ? colors.cardBackground
            : colors.surfaceSecondary,
          // **No shadow on focus, on either platform** — same rule, and the same
          // reason, as <FormField>. A shadow on the container of a focused input
          // blurs it the instant it focuses: the keyboard opens and shuts again
          // and no character ever lands. The border stepping up to `textPrimary`
          // and the fill lifting to `cardBackground` are focus affordance enough.
        },
        style,
      ]}
    >
      <Ionicons
        name="search"
        size={ICON.sm}
        color={focused ? colors.textPrimary : colors.textMuted}
        style={{ marginEnd: SPACING.sm }}
      />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // "Search" on the keyboard's action key, and it dismisses rather than
        // submits: the list is already filtered on every keystroke, so there is
        // nothing left for the key to do but get out of the way.
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        // Suppresses the iOS clear button; this bar has its own, which is themed
        // and the same on both platforms.
        clearButtonMode="never"
        style={{
          ...TYPO.body,
          flex: 1,
          minWidth: 0,
          color: colors.textPrimary,
          // A query can be Arabic; align to the script actually typed.
          textAlign: resolveTextAlign(value),
          // Android adds the font's own ascent/descent on top of the line box,
          // which pushes the text off centre in a fixed-height row.
          includeFontPadding: false,
          textAlignVertical: 'center',
          paddingVertical: 0,
        }}
      />

      {hasQuery && (
        <PressableScale
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={{
            width: 28,
            height: 28,
            borderRadius: RADIUS.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.iconBackground,
            marginStart: SPACING.sm,
          }}
        >
          <Ionicons
            name="close"
            size={ICON.sm - 2}
            color={colors.textSecondary}
          />
        </PressableScale>
      )}
    </View>
  );
}

/**
 * "3 of 42" — how much of a list a query is showing. Rendered next to a section
 * title rather than inside the bar, so a long placeholder never has to share its
 * line with a number.
 *
 * `noun` is what the unfiltered total counts ("42 claims", "42 notifications").
 * It defaults to `claim`, so Expense Claims — the first caller — reads exactly as
 * it did before. `plural` covers anything that isn't a bare `+s`.
 */
export function SearchCount({
  matches,
  total,
  noun = 'claim',
  plural = `${noun}s`,
  style,
}) {
  const { colors } = useAppTheme();

  return (
    <Text style={[{ ...TYPO.caption, color: colors.textMuted }, style]}>
      {matches === total
        ? `${total} ${total === 1 ? noun : plural}`
        : `${matches} of ${total}`}
    </Text>
  );
}

export default SearchBar;

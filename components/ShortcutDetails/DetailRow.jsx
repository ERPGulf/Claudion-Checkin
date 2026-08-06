/* eslint-disable react/prop-types */
import React from 'react';
import { I18nManager, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/** Chip, gutters and row height. Shared with <RowDivider> below. */
const CHIP = 36;
const PAD_V = 12;

/**
 * One field of a document: glyph, label, value.
 *
 * A read-only sibling of <SettingsRow>, not a use of it. SettingsRow's trailing
 * slot caps a value at 46% of the row and truncates — right for a settings
 * screen, wrong here, where the value *is* the content and a passport number or
 * a sponsor name is longer than the label. So the value gets the room instead:
 * the label is the fixed-width side, and the value wraps rather than clipping.
 *
 * It is also deliberately not pressable. Nothing on this screen navigates, and a
 * row that scales under the finger but does nothing is a broken affordance.
 * The whole row is one accessibility node, so a screen reader reads
 * "Card Number, 389290" rather than two loose strings.
 *
 * Heights are `minHeight`, so a wrapped value or a large font scale grows the
 * row instead of clipping it.
 */
function DetailRow({ icon, label, value }) {
  const { colors } = useAppTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: CHIP + PAD_V * 2,
        paddingVertical: PAD_V,
        paddingHorizontal: SPACING.lg,
      }}
    >
      <View
        style={{
          width: CHIP,
          height: CHIP,
          borderRadius: RADIUS.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.iconBackground,
        }}
      >
        <Ionicons name={icon} size={ICON.md} color={colors.textSecondary} />
      </View>

      <Text
        style={{
          ...TYPO.subhead,
          fontWeight: '400',
          color: colors.textSecondary,
          marginStart: SPACING.md,
          // Android pads a line box by the font's own ascent/descent, which
          // lifts a single line optically above the chip beside it.
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>

      <Text
        style={{
          ...TYPO.headline,
          flex: 1,
          minWidth: 0,
          marginStart: SPACING.md,
          color: colors.textPrimary,
          // Aligned to the row's trailing edge, so a column of values shares one
          // edge. `textAlign` is physical in React Native — it does *not* flip
          // with the layout the way `marginStart` does — so under RTL, where the
          // row itself has already reversed, 'right' would push the value back
          // against its own label. Mirror it explicitly.
          textAlign: I18nManager.isRTL ? 'left' : 'right',
          includeFontPadding: false,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/** Hairline between rows, inset past the chip so it aligns with the labels. */
export function DetailDivider() {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        height: 1,
        marginStart: SPACING.lg + CHIP + SPACING.md,
        backgroundColor: colors.dividerSubtle,
      }}
    />
  );
}

/**
 * Memoised: a document with twenty fields renders twenty of these, and the only
 * thing that ever changes is the palette. The props are three strings, so the
 * default shallow comparison is exactly right.
 */
export default React.memo(DetailRow);

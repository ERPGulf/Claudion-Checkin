/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { RADIUS, SHADOWS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * The standard elevated surface: one radius, one border, one shadow, resolved
 * per palette. Extracted because this exact block was repeated in the Home
 * cards and five times over on Profile.
 *
 * `padded` adds the default inset — omit it when the card holds full-bleed
 * <SettingsRow> children, which carry their own horizontal padding so their
 * dividers can run edge to edge.
 */
function Card({ children, style, padded = false }) {
  const { colors, isDark } = useAppTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.cardBackground,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          // A shadow over a near-black page is invisible, so in dark mode the
          // border and the lighter card surface carry the elevation alone.
          ...(isDark ? null : SHADOWS.card),
        },
        padded && { padding: SPACING.lg },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export default Card;

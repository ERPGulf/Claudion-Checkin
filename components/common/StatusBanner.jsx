/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

const TONE_ICON = {
  success: 'checkmark-circle',
  warning: 'alert-circle',
  error: 'close-circle',
  info: 'information-circle',
  accent: 'sparkles',
};

/**
 * Inline status callout: tinted surface, hairline border, semantic glyph.
 *
 * Reads its three colours off one `tone`, so a banner can never end up with a
 * success background and an error icon. Text is left-aligned rather than
 * centred — centred paragraphs are hard to scan once they wrap past one line.
 */
function StatusBanner({ tone = 'info', icon, title, message, style }) {
  const { colors } = useAppTheme();

  return (
    <View
      accessible
      accessibilityRole="summary"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          padding: SPACING.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors[`${tone}Border`],
          backgroundColor: colors[`${tone}Surface`],
        },
        style,
      ]}
    >
      <Ionicons
        name={icon || TONE_ICON[tone] || TONE_ICON.info}
        size={ICON.md}
        color={colors[`${tone}Text`]}
        style={{ marginTop: 1 }}
      />

      <View style={{ flex: 1, marginStart: SPACING.sm }}>
        {!!title && (
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '600',
              color: colors[`${tone}Text`],
            }}
          >
            {title}
          </Text>
        )}
        {!!message && (
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '400',
              color: colors.textSecondary,
              marginTop: title ? 2 : 0,
            }}
          >
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

export default StatusBanner;

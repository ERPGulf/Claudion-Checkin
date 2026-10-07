/* eslint-disable react/prop-types */
import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, View, Text } from 'react-native';
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
function StatusBanner({
  tone = 'info',
  icon,
  title,
  message,
  // Errors appear because something just failed, so they are spoken; other
  // tones are often on screen from the start and would only add noise.
  announce = tone === 'error',
  style,
}) {
  const { colors } = useAppTheme();
  const label = [title, message].filter(Boolean).join('. ');

  // Android reads the live region below; iOS ignores it and must be told.
  useEffect(() => {
    if (announce && label && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(label);
    }
  }, [announce, label]);

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion={announce ? 'polite' : 'none'}
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

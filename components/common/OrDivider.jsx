/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * "── or ──" between a screen's own action and the other ways to sign in.
 * Decorative, so screen readers skip it; the buttons carry their own labels.
 */
function OrDivider({ style }) {
  const { colors } = useAppTheme();
  const line = <View style={{ flex: 1, height: 1, backgroundColor: colors.cardBorder }} />;

  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center' }, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {line}
      <Text style={{ ...TYPO.caption, color: colors.textMuted, marginHorizontal: SPACING.md }}>
        or
      </Text>
      {line}
    </View>
  );
}

export default OrDivider;

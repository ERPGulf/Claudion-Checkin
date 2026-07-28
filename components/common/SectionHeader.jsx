/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * Screen-level section label with an optional trailing text action.
 * Replaces the ad-hoc "Quick Access / Add New" row and doubles as the
 * "Menu" label, so both sit on the same baseline and type size.
 */
function SectionHeader({
  title,
  subtitle,
  actionLabel,
  actionIcon,
  onActionPress,
  style,
}) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: SPACING.md,
        },
        style,
      ]}
    >
      <View style={{ flex: 1, paddingEnd: SPACING.sm }}>
        <Text
          accessibilityRole="header"
          style={{ ...TYPO.title3, color: colors.textPrimary }}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
            {subtitle}
          </Text>
        )}
      </View>

      {!!actionLabel && !!onActionPress && (
        <PressableScale
          onPress={onActionPress}
          accessibilityLabel={actionLabel}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '600',
              color: colors.primary2,
              marginEnd: SPACING.xs,
            }}
          >
            {actionLabel}
          </Text>
          {!!actionIcon && (
            <Ionicons name={actionIcon} size={ICON.sm} color={colors.primary2} />
          )}
        </PressableScale>
      )}
    </View>
  );
}

export default SectionHeader;

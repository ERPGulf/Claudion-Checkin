/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * Empty state for a card body: tinted glyph, one-line title, supporting text,
 * and an optional inline CTA. Replaces dashed placeholder borders, which read
 * as an unfinished layout rather than an invitation.
 */
function EmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  actionLabel,
  onActionPress,
  compact = false,
}) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: compact ? SPACING.lg : SPACING.xxl,
        paddingHorizontal: SPACING.lg,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: RADIUS.lg,
          backgroundColor: colors.accentSurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: SPACING.md,
        }}
      >
        <Ionicons name={icon} size={26} color={colors.primary2} />
      </View>

      {!!title && (
        <Text
          style={{
            ...TYPO.headline,
            color: colors.textPrimary,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
      )}

      {!!description && (
        <Text
          style={{
            ...TYPO.subhead,
            fontWeight: '400',
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: SPACING.xs,
            maxWidth: 280,
          }}
        >
          {description}
        </Text>
      )}

      {!!actionLabel && !!onActionPress && (
        <PressableScale
          onPress={onActionPress}
          accessibilityLabel={actionLabel}
          style={{
            marginTop: SPACING.lg,
            paddingVertical: SPACING.sm + 2,
            paddingHorizontal: SPACING.lg,
            borderRadius: RADIUS.md,
            // `buttonFill`, not `primary`: primary is near-black, which would
            // vanish against a dark card.
            backgroundColor: colors.buttonFill,
          }}
        >
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '600',
              color: colors.buttonFillText,
            }}
          >
            {actionLabel}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

export default EmptyState;

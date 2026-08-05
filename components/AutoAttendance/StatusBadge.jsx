/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * A semantic status pill: tinted surface, hairline border, matching label.
 *
 * Reads all three colours off one `tone`, so a badge can never end up with a
 * success tint and an error label — the same contract <StatusBanner> uses. That
 * is the whole point of replacing the plain "Not Monitoring" / "ENTER" / "OFF"
 * strings: the state now carries its own colour, and the colour comes from one
 * place.
 *
 * `dot` renders a filled circle instead of a glyph, for states where a coloured
 * indicator reads faster than an icon (monitoring on/off).
 */
function StatusBadge({ tone = 'neutral', label, icon, dot = false, style }) {
  const { colors } = useAppTheme();

  const foreground = colors[`${tone}Text`] || colors.textSecondary;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          // `center`, not `flex-start`. In a row this matches the parent's
          // cross-axis centring instead of overriding it — as `flex-start` did,
          // which pinned the badge to the top of a <SettingsRow> while a plain
          // text value in the same slot stayed centred, so badge rows and value
          // rows disagreed. In a column it still hugs its content rather than
          // stretching, which is why the property is here at all.
          alignSelf: 'center',
          paddingHorizontal: SPACING.sm,
          paddingVertical: 3,
          borderRadius: RADIUS.pill,
          borderWidth: 1,
          borderColor: colors[`${tone}Border`] || colors.cardBorder,
          backgroundColor: colors[`${tone}Surface`] || colors.neutralSurface,
        },
        style,
      ]}
    >
      {dot ? (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: RADIUS.pill,
            backgroundColor: foreground,
            marginEnd: SPACING.xs + 1,
          }}
        />
      ) : (
        !!icon && (
          <Ionicons
            name={icon}
            size={ICON.sm - 3}
            color={foreground}
            style={{ marginEnd: SPACING.xs }}
          />
        )
      )}

      <Text
        style={{ ...TYPO.caption2, fontWeight: '600', color: foreground }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export default StatusBadge;

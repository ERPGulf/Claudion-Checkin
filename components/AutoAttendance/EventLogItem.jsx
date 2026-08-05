/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { describeTransition, formatTimestamp } from '../../utils/autoAttendance';
import StatusBadge from './StatusBadge';

/**
 * One geofence event as a timeline row: a tinted glyph on a rail, the
 * description, its timestamp, and a badge for the transition.
 *
 * The rail is a 1px line behind the glyph rather than a border on the row, so a
 * run of events reads as one sequence instead of a stack of separate cards. It
 * stops short on the last row (`isLast`), which is what makes the series look
 * finished rather than cut off.
 *
 * The raw transition string is still shown — as the badge label — because on a
 * debugging screen the exact token the native module emitted is the useful part.
 */
function EventLogItem({ entry, isLast = false }) {
  const { colors } = useAppTheme();
  const { tone, label, icon } = describeTransition(entry?.transition);

  const foreground = colors[`${tone}Text`] || colors.textSecondary;

  return (
    <View style={{ flexDirection: 'row' }}>
      {/* Rail + node */}
      <View style={{ width: 28, alignItems: 'center' }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: RADIUS.pill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors[`${tone}Border`] || colors.cardBorder,
            backgroundColor: colors[`${tone}Surface`] || colors.neutralSurface,
          }}
        >
          <Ionicons name={icon} size={ICON.sm - 3} color={foreground} />
        </View>

        {!isLast && (
          <View
            style={{
              flex: 1,
              width: 1,
              backgroundColor: colors.dividerSubtle,
              marginTop: 2,
            }}
          />
        )}
      </View>

      <View
        style={{
          flex: 1,
          minWidth: 0,
          marginStart: SPACING.md,
          paddingBottom: isLast ? 0 : SPACING.md,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <StatusBadge tone={tone} label={label} />
          <Text
            style={{
              ...TYPO.caption2,
              color: colors.textMuted,
              marginStart: SPACING.sm,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {formatTimestamp(entry?.timestamp || entry?.receivedAt)}
          </Text>
        </View>

        <Text
          style={{
            ...TYPO.caption,
            color: colors.textSecondary,
            marginTop: 2,
          }}
        >
          {entry?.message || entry?.transition || 'Event'}
        </Text>
      </View>
    </View>
  );
}

export default EventLogItem;

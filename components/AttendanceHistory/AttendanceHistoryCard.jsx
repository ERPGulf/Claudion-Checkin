/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';
import {
  describeLogSource,
  describeLogType,
  describeSyncStatus,
  formatLogDate,
  formatLogTime,
  parseLogTime,
} from '../../utils/attendanceHistory';

/**
 * A small tinted pill under the row's label.
 *
 * Two of these can sit side by side — the sync state and the source device —
 * so the row they live in wraps rather than truncating one of them. Extracted
 * because the sync chip and the device badge are the same object with different
 * words in it, and drifting apart would read as two unrelated affordances.
 */
function Chip({ icon, label, surface, text }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginEnd: SPACING.xs,
        marginTop: 2,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 2,
        borderRadius: RADIUS.pill,
        backgroundColor: surface,
      }}
    >
      <Ionicons name={icon} size={11} color={text} />
      <Text
        numberOfLines={1}
        style={{ ...TYPO.caption2, color: text, marginStart: 3 }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * One attendance punch.
 *
 * Reads as three columns: a tinted glyph carrying the colour cue, the status and
 * any exceptional detail, then the time. The status label is the most prominent
 * element and the time is the only tabular figure, so the eye can run straight
 * down the right edge comparing times.
 *
 * The type is deliberately *not* also rendered as a pill next to the label —
 * that would state the same fact twice in one row. The tinted glyph is the badge.
 * The badge slot on the right is reserved for what the label can't say: a punch
 * that came from somewhere other than this app.
 *
 * `position` lets a day's rows share one surface: only the ends get rounded, and
 * every row but the last draws a hairline. `showDate` is on by default so the row
 * stands alone anywhere, and the grouped screen turns it off because its section
 * header already names the day.
 *
 * `syncStatus` marks a punch this device made that the server may not have yet.
 * It is null for every server record — which is nearly all of them — so the
 * ordinary row is untouched and the chip is genuinely exceptional, in the same
 * slot and the same shape as the device badge.
 */
function AttendanceHistoryCard({
  logType,
  time,
  deviceId,
  syncStatus = null,
  position = 'single',
  showDate = true,
  onPress,
}) {
  const { colors } = useAppTheme();

  const date = parseLogTime(time);
  const { label, tone, icon } = describeLogType(logType);
  const source = describeLogSource(deviceId);
  const sync = describeSyncStatus(syncStatus);

  const isFirst = position === 'first' || position === 'single';
  const isLast = position === 'last' || position === 'single';

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.lg,
        // 14 rather than 16: with a 40pt glyph this lands the row at ~68pt,
        // comfortably over the 44pt minimum touch target without feeling loose.
        paddingVertical: 14,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: RADIUS.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors[`${tone}Surface`],
        }}
      >
        <Ionicons name={icon} size={ICON.md} color={colors[`${tone}Text`]} />
      </View>

      <View style={{ flex: 1, marginStart: SPACING.md }}>
        <Text
          numberOfLines={1}
          style={{ ...TYPO.headline, color: colors.textPrimary }}
        >
          {label}
        </Text>

        {(!!source || !!sync) && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: 3,
            }}
          >
            {!!sync && (
              <Chip
                icon={sync.icon}
                label={sync.label}
                surface={colors[`${sync.tone}Surface`]}
                text={colors[`${sync.tone}Text`]}
              />
            )}
            {!!source && (
              <Chip
                icon="hardware-chip-outline"
                label={source}
                surface={colors.neutralSurface}
                text={colors.neutralText}
              />
            )}
          </View>
        )}
      </View>

      <View style={{ alignItems: 'flex-end', marginStart: SPACING.sm }}>
        <Text
          style={{
            ...TYPO.title3,
            color: colors.textPrimary,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatLogTime(date)}
        </Text>
        {showDate && (
          <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
            {formatLogDate(date)}
          </Text>
        )}
      </View>

      {!!onPress && (
        <Ionicons
          name="chevron-forward"
          size={ICON.sm}
          color={colors.textMuted}
          style={{ marginStart: SPACING.xs }}
        />
      )}
    </View>
  );

  const surface = {
    backgroundColor: colors.cardBackground,
    borderTopStartRadius: isFirst ? RADIUS.xl : 0,
    borderTopEndRadius: isFirst ? RADIUS.xl : 0,
    borderBottomStartRadius: isLast ? RADIUS.xl : 0,
    borderBottomEndRadius: isLast ? RADIUS.xl : 0,
  };

  // One combined label, so a screen reader announces "Checked out, 05:39 PM,
  // 28 Jul 2026" as a single row instead of three unrelated fragments.
  const a11yLabel = [
    label,
    formatLogTime(date),
    formatLogDate(date),
    source ? `from ${source}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={surface}>
      {onPress ? (
        <PressableScale
          onPress={onPress}
          scaleTo={0.99}
          hitSlop={0}
          accessibilityLabel={a11yLabel}
        >
          {body}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={a11yLabel}>
          {body}
        </View>
      )}

      {!isLast && (
        <View
          style={{
            height: 1,
            backgroundColor: colors.dividerSubtle,
            // Starts under the text, not the glyph — an inset rule reads as
            // "same group, next item", a full-width one as a hard break.
            marginStart: SPACING.lg + 40 + SPACING.md,
          }}
        />
      )}
    </View>
  );
}

export default AttendanceHistoryCard;

/* eslint-disable react/prop-types */
import React, { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';
import { resolveTextAlign } from '../../utils/textDirection';
import {
  formatNotificationTime,
  notificationIcon,
} from '../../utils/notifications';

/** Round chip, like a sender avatar. 40pt keeps the row at 44pt+ on its own. */
const CHIP = 40;

/**
 * One notification: round tinted category chip, then title over a two-line
 * preview, with the time and an unread dot or a chevron on the trailing edge.
 *
 * Read and unread differ by weight and one dot, not by inverting the card. The
 * classic row turned a near-black `#1F2937` panel with light text on for unread
 * items, which made the unread state read as a different component and, in dark
 * mode, as a hole in the page. Here unread keeps the card surface and adds three
 * quiet cues: a semibold title, full-strength preview text, and a tinted dot in
 * the category's colour. Read rows drop to the muted preview and show a chevron
 * instead — so the eye finds unread items by weight rather than by colour alone,
 * which also survives greyscale and colour-blind vision.
 *
 * Presentation only: `onPress` is handed straight through to the hook's
 * `openNotification`, which is the classic screen's handler — the same badge
 * decrement, the same optimistic read flag, the same mark-as-read call.
 *
 * Memoised, and the screen passes a stable `onPress`, so typing in the search bar
 * re-renders the list container rather than every row in it.
 */
function NotificationRow({ notification, onPress, style }) {
  const { colors } = useAppTheme();

  const isUnread = notification.read === 0;
  const { icon, tone } = notificationIcon(notification.type);
  const time = formatNotificationTime(notification.date);

  const title = notification.title || 'Notification';
  const body = notification.notification || '';

  return (
    <PressableScale
      onPress={() => onPress(notification)}
      scaleTo={0.99}
      hitSlop={0}
      accessibilityRole="button"
      // One announcement per row rather than four loose text nodes, and it leads
      // with the state — a screen-reader user should not have to reach the end of
      // the message to learn the thing is unread.
      accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${title}. ${body}${
        time ? `. ${time}` : ''
      }`}
      accessibilityHint="Opens the full notification"
      style={[
        {
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'flex-start',
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.md,
        },
        style,
      ]}
    >
      <View
        style={{
          width: CHIP,
          height: CHIP,
          borderRadius: RADIUS.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors[`${tone}Surface`],
          borderWidth: 1,
          borderColor: colors[`${tone}Border`],
        }}
      >
        <Ionicons name={icon} size={ICON.md} color={colors[`${tone}Text`]} />
      </View>

      <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text
            numberOfLines={1}
            style={{
              ...TYPO.subhead,
              // The unread cue that survives greyscale.
              fontWeight: isUnread ? '600' : '500',
              flex: 1,
              minWidth: 0,
              color: colors.textPrimary,
              textAlign: resolveTextAlign(title),
            }}
          >
            {title}
          </Text>

          {!!time && (
            <Text
              style={{
                ...TYPO.caption2,
                color: colors.textMuted,
                marginStart: SPACING.sm,
                fontVariant: ['tabular-nums'],
              }}
            >
              {time}
            </Text>
          )}
        </View>

        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{
            ...TYPO.caption,
            fontWeight: '400',
            marginTop: 2,
            color: isUnread ? colors.textSecondary : colors.textMuted,
            // Frappe notification bodies are regularly Arabic; align to the
            // script the message actually contains rather than assuming Latin.
            textAlign: resolveTextAlign(body),
          }}
        >
          {body}
        </Text>
      </View>

      {/* Fixed-width slot, so a dot and a chevron occupy the same space and rows
          don't shift by a few points when one is marked read. */}
      <View
        style={{
          width: ICON.md,
          alignItems: 'center',
          justifyContent: 'center',
          marginStart: SPACING.sm,
          paddingTop: 2,
        }}
      >
        {isUnread ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: RADIUS.pill,
              backgroundColor: colors[`${tone}Text`],
            }}
          />
        ) : (
          <Ionicons
            name="chevron-forward"
            size={ICON.sm}
            color={colors.textMuted}
          />
        )}
      </View>
    </PressableScale>
  );
}

export default memo(NotificationRow);

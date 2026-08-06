/* eslint-disable react/prop-types */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import BottomSheet from '../common/BottomSheet';
import { resolveTextAlign } from '../../utils/textDirection';
import {
  formatDateLabel,
  formatNotificationTime,
  notificationIcon,
} from '../../utils/notifications';

/**
 * The full text of one notification.
 *
 * Still an in-screen sheet, not a route: tapping a notification opens exactly
 * what it opened before, so navigation is untouched. What changed is the chrome —
 * the classic screen hand-rolled a Modal with a `#FFFFFF` panel, its own drag
 * indicator and its own close button, which is a bright white card over a
 * near-black page in dark mode. This uses the shared <BottomSheet>, the same
 * panel the attachment picker and the option sheets use: themed surfaces, one
 * backdrop, swipe-to-dismiss and a real close target, none of it duplicated here.
 *
 * The date line is the same `date` string the classic sheet showed, read through
 * the app's own formatters ("Today · 2:33 PM") instead of printed raw.
 */
function NotificationSheet({ notification, onClose }) {
  const { colors } = useAppTheme();

  const { icon, tone } = notificationIcon(notification?.type);
  const time = notification?.date
    ? formatNotificationTime(notification.date)
    : null;
  const day = notification?.date ? formatDateLabel(notification.date) : null;
  const stamp = [day, time].filter(Boolean).join(' · ');

  const body = notification?.notification || '';

  return (
    <BottomSheet
      visible={!!notification}
      onClose={onClose}
      title={notification?.title || 'Notification'}
      subtitle={stamp || undefined}
      closeLabel="Close"
    >
      <View style={{ paddingBottom: SPACING.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: SPACING.lg,
            paddingBottom: SPACING.md,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors[`${tone}Surface`],
              borderWidth: 1,
              borderColor: colors[`${tone}Border`],
              marginEnd: SPACING.sm,
            }}
          >
            <Ionicons
              name={icon}
              size={ICON.sm}
              color={colors[`${tone}Text`]}
            />
          </View>

          {!!notification?.type && (
            <Text
              style={{
                ...TYPO.caption,
                color: colors.textMuted,
                textTransform: 'capitalize',
                flex: 1,
                minWidth: 0,
              }}
              numberOfLines={1}
            >
              {notification.type}
            </Text>
          )}
        </View>

        {/* The body can be long; it scrolls inside the sheet rather than pushing
            the panel past its max height. */}
        <ScrollView
          style={{ maxHeight: 320 }}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <Text
            style={{
              ...TYPO.body,
              color: colors.textSecondary,
              textAlign: resolveTextAlign(body),
            }}
          >
            {body}
          </Text>
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

export default NotificationSheet;

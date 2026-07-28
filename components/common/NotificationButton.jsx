/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ICON, RADIUS } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * Bell + unread badge. Presentational only — the caller supplies `count` and
 * `onPress`, so this works anywhere the unread count is available.
 */
function NotificationButton({ count = 0, onPress, size = 40 }) {
  const { colors } = useAppTheme();
  const hasUnread = count > 0;
  const label = hasUnread ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS.pill,
        backgroundColor: colors.iconBackground,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons
        name="bell-outline"
        color={colors.textPrimary}
        size={ICON.lg}
      />
      {hasUnread && (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 18,
            height: 18,
            borderRadius: RADIUS.pill,
            backgroundColor: colors.red,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 5,
            borderWidth: 2,
            // Matches the surface behind the bell so the badge reads as a
            // cut-out in both palettes.
            borderColor: colors.surfaceElevated,
          }}
        >
          <Text
            allowFontScaling={false}
            style={{ color: colors.white, fontSize: 10, fontWeight: '700' }}
          >
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

export default NotificationButton;

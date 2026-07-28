import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { resolveTextAlign } from '../../utils/textDirection';
import Avatar from '../common/Avatar';
import NotificationButton from '../common/NotificationButton';

function getGreeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Home identity header. Same data and the same single action (Notifications)
 * as before, rendered as a light elevated card instead of a 192pt black block:
 * the page no longer opens with a wall of dark pixels, and the employee's name
 * becomes the largest thing on screen rather than the word "Home".
 */
function WelcomeCard() {
  const navigation = useNavigation();
  const { colors, isDark } = useAppTheme();
  const fullname = useSelector(state => state.user.fullname);
  const employeeCode = useSelector(
    state => state.user?.userDetails?.employeeCode,
  );
  const unreadCount = useSelector(
    state => state.notification?.unreadCount ?? 0,
  );

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);
  // Arabic names align to their own script so the block never reads as ragged.
  const align = resolveTextAlign(fullname, 'left');

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: colors.cardBackground,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        paddingVertical: SPACING.lg,
        paddingHorizontal: SPACING.lg,
        flexDirection: 'row',
        alignItems: 'center',
        ...(isDark ? null : SHADOWS.card),
      }}
    >
      <Avatar name={fullname} size={48} />

      <View style={{ flex: 1, marginHorizontal: SPACING.md }}>
        <Text
          style={{
            ...TYPO.subhead,
            color: colors.textMuted,
            textAlign: align,
          }}
        >
          {greeting}
        </Text>

        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          style={{
            ...TYPO.title2,
            // adjustsFontSizeToFit + an explicit lineHeight mis-centers the
            // shrunken text on Android, so let the platform derive it.
            lineHeight: undefined,
            color: colors.textPrimary,
            textAlign: align,
            writingDirection: 'auto',
            marginTop: 2,
          }}
        >
          {fullname || 'username'}
        </Text>

        {!!employeeCode && (
          <Text
            numberOfLines={1}
            style={{
              ...TYPO.caption,
              color: colors.textMuted,
              textAlign: align,
              marginTop: SPACING.xs,
            }}
          >
            {employeeCode}
          </Text>
        )}
      </View>

      <NotificationButton
        count={unreadCount}
        onPress={() => navigation.navigate('Notifications')}
      />
    </View>
  );
}

export default WelcomeCard;

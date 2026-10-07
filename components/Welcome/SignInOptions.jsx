/* eslint-disable react/prop-types */
import React from 'react';
import { I18nManager, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { isMobileAuthAvailable } from '../../utils/mobileAuthCrypto';
import PressableScale from '../common/PressableScale';

/**
 * The two ways in, as peers: same surface, size and layout, so neither reads as
 * the primary. Each says what it needs, because a first-run employee has to
 * pick one before anything else on the app makes sense.
 *
 * The card styling sits on the pressable itself, as on an elevated
 * <ActionButton>: an Android shadow drawn by a child of a scaling view is clipped
 * to a hard rectangle.
 */
function SignInOptions() {
  const navigation = useNavigation();
  const { colors, isDark } = useAppTheme();
  const options = [
    {
      label: 'Scan QR code',
      hint: 'Use the QR code from your company.',
      icon: 'qr-code-outline',
      route: 'Qrscan',
    },
    isMobileAuthAvailable() && {
      label: 'Sign in with mobile number',
      hint: 'Use your company code and mobile number.',
      icon: 'phone-portrait-outline',
      route: 'mobile login',
    },
  ].filter(Boolean);

  return (
    <View style={{ gap: SPACING.md }}>
      {options.map(option => (
        <PressableScale
          key={option.route}
          accessibilityLabel={option.label}
          accessibilityHint={option.hint}
          scaleTo={0.98}
          hitSlop={0}
          onPress={() => navigation.navigate(option.route)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: SPACING.lg,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            backgroundColor: colors.cardBackground,
            ...(isDark ? null : SHADOWS.card),
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: RADIUS.md,
              backgroundColor: colors.accentSurface,
              alignItems: 'center',
              justifyContent: 'center',
              marginEnd: SPACING.md,
            }}
          >
            <Ionicons name={option.icon} size={ICON.lg} color={colors.accentText} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>{option.label}</Text>
            <Text style={{ ...TYPO.caption, fontWeight: '400', color: colors.textSecondary, marginTop: 2 }}>
              {option.hint}
            </Text>
          </View>
          <Ionicons
            name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
            size={ICON.md}
            color={colors.textMuted}
            style={{ marginStart: SPACING.sm }}
          />
        </PressableScale>
      ))}
    </View>
  );
}

export default SignInOptions;

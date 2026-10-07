import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, I18nManager, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BUILD_TAG, ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useReducedMotion from '../../hooks/useReducedMotion';
import { hapticsMessage } from '../../utils/HapticsMessage';
import PressableScale from '../common/PressableScale';
import StatusBanner from '../common/StatusBanner';
import BrandMark from '../Welcome/BrandMark';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Sits above the fields rather than below the actions: the keyboard usually
// stays up after a submit, and anything under the buttons is behind it.
function ErrorBanner({ message }) {
  const reduceMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(enter, { toValue: 1, duration: 200, easing: EASE_OUT, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [enter]);
  // One haptic per failure, in the frame it appears (StatusBanner speaks it).
  useEffect(() => {
    hapticsMessage('error');
  }, [message]);
  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  return (
    <Animated.View style={{ opacity: enter, transform: reduceMotion ? [] : [{ translateY: rise }] }}>
      <StatusBanner tone="error" title={mobileLoginCopy('errorTitle')} message={message} />
    </Animated.View>
  );
}

// Quiet text-weight action for resend and recovery, so a step has one loud
// button instead of a stack of equal ones.
export function TextAction({ label, onPress, disabled, style }) {
  const { colors } = useAppTheme();
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[{ minHeight: 44, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: SPACING.md }, style]}
    >
      {/* Tabular so a ticking "Resend in 9s" does not shuffle its width. */}
      <Text style={{ ...TYPO.headline, fontVariant: ['tabular-nums'], color: disabled ? colors.textMuted : colors.accentText }}>{label}</Text>
    </PressableScale>
  );
}

export default function AuthStepLayout({ title, subtitle, children }) {
  const { colors } = useAppTheme();
  const { login, onBack, showBack } = useMobileLoginFlow();
  const busy = login.isLoading || login.isHydrating;
  const textAlign = I18nManager.isRTL ? 'right' : 'left';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg }}
          keyboardShouldPersistTaps="handled"
          // Android has no interactive dismissal; it would silently mean "none".
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ minHeight: 44, alignItems: 'flex-start' }}>
            {showBack && (
              <PressableScale
                accessibilityLabel={mobileLoginCopy('back')}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={onBack}
                style={{ minHeight: 44, minWidth: 44, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.iconBackground }}
              >
                <Ionicons name={I18nManager.isRTL ? 'arrow-forward' : 'arrow-back'} size={ICON.md} color={busy ? colors.textMuted : colors.textPrimary} />
              </PressableScale>
            )}
          </View>
          <View style={{ flex: 0.35, minHeight: SPACING.xxl }} />
          <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>
            <View style={{ alignItems: 'center', marginBottom: SPACING.xxxl }}>
              <BrandMark width={152} />
            </View>
            <Text accessibilityRole="header" style={{ ...TYPO.title1, color: colors.textPrimary, textAlign }}>{title}</Text>
            {!!subtitle && <Text style={{ ...TYPO.body, color: colors.textSecondary, textAlign, marginTop: SPACING.md }}>{subtitle}</Text>}
            <View style={{ marginTop: SPACING.xxxl, gap: SPACING.xl }}>
              {!!login.error && <ErrorBanner message={login.error} />}
              {login.isHydrating
                ? <ActivityIndicator accessibilityLabel={mobileLoginCopy('loading')} color={colors.textMuted} />
                : children}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: SPACING.xxxl }} />
          <Text style={{ ...TYPO.caption2, color: colors.textMuted, textAlign: 'center' }}>{BUILD_TAG}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function CompleteStep() {
  const { colors } = useAppTheme();
  return (
    <AuthStepLayout title={mobileLoginCopy('completing')} subtitle={mobileLoginCopy('completingSubtitle')}>
      <ActivityIndicator accessibilityLabel={mobileLoginCopy('completing')} color={colors.primary2} />
    </AuthStepLayout>
  );
}

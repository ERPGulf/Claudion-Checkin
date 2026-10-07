import React from 'react';
import { ActivityIndicator, I18nManager, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BUILD_TAG, ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';
import StatusBanner from '../common/StatusBanner';
import BrandMark from '../Welcome/BrandMark';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

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
          keyboardDismissMode="interactive"
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
              {login.isHydrating
                ? <ActivityIndicator accessibilityLabel={mobileLoginCopy('loading')} color={colors.textMuted} />
                : children}
            </View>
            {!!login.error && <StatusBanner tone="error" title={mobileLoginCopy('errorTitle')} message={login.error} style={{ marginTop: SPACING.lg }} />}
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

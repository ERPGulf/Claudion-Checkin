import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { SPACING, TYPO } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import useMobileLogin from '../hooks/useMobileLogin';
import ActionButton from '../components/common/ActionButton';
import FormField from '../components/common/FormField';
import ModuleCard from '../components/common/ModuleCard';
import PressableScale from '../components/common/PressableScale';
import StatusBanner from '../components/common/StatusBanner';
import { isMobileAuthAvailable } from '../utils/mobileAuthCrypto';

const isOptional = credential =>
  String(credential?.requirement).toUpperCase() === 'OPTIONAL';
const isEnabled = credential =>
  !!credential && credential.requirement !== 'disabled';

function MobileLoginForm() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  const login = useMobileLogin();
  const passwordCredential = login.flow?.credentials?.password;
  const creatingFlowPassword = passwordCredential?.purpose === 'create';
  const otpCredential = login.flow?.credentials?.otp;
  const changingPassword = !!login.passwordMode;
  const showOtp = changingPassword || isEnabled(otpCredential);
  const loading = login.isLoading || login.isHydrating;
  const title = changingPassword
    ? login.passwordMode === 'create' ? 'Create a password' : 'Reset password'
    : 'Sign in with mobile number';
  const submit = changingPassword
    ? login.savePassword
    : login.flow ? login.complete : login.begin;
  const buttonLabel = changingPassword
    ? 'Save password'
    : login.flow ? 'Sign in' : 'Continue';

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            padding: SPACING.lg,
            paddingTop: SPACING.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text
            accessibilityRole="header"
            style={{ ...TYPO.title2, color: colors.textPrimary, marginBottom: SPACING.xl }}
          >
            {title}
          </Text>

          {login.isHydrating ? (
            <ActivityIndicator accessibilityLabel="Loading sign-in" color={colors.textMuted} />
          ) : (
            <>
              <ModuleCard dense icon="phone-portrait-outline" title="Your account" style={{ marginBottom: SPACING.xl }}>
                {!login.backendUrl && (
                  <FormField
                    label="Company code"
                    icon="business-outline"
                    value={login.companyCode}
                    onChangeText={login.setCompanyCode}
                    errorText={login.companyCodeError}
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="off"
                    returnKeyType="next"
                    style={{ marginBottom: SPACING.lg }}
                  />
                )}
                {!!login.backendUrl && (
                  <View style={{ marginBottom: SPACING.md }}>
                    <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>Company selected</Text>
                    <PressableScale
                      accessibilityLabel="Change company"
                      disabled={loading}
                      accessibilityState={{ disabled: loading }}
                      onPress={login.changeCompany}
                      style={{ alignSelf: 'flex-start', paddingVertical: SPACING.md }}
                    >
                      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Change company</Text>
                    </PressableScale>
                  </View>
                )}
                <FormField
                  label="Mobile number"
                  icon="call-outline"
                  value={login.mobileNumber}
                  onChangeText={login.setMobileNumber}
                  errorText={login.mobileNumberError}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  autoCapitalize="none"
                  disabled={loading}
                  style={{ marginBottom: SPACING.lg }}
                />
                {!changingPassword && isEnabled(passwordCredential) && (
                  <FormField
                    label={creatingFlowPassword ? 'New password' : 'Password'}
                    icon="lock-closed-outline"
                    value={login.password}
                    onChangeText={login.setPassword}
                    optional={isOptional(passwordCredential)}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete={creatingFlowPassword ? 'new-password' : 'password'}
                    textContentType={creatingFlowPassword ? 'newPassword' : 'password'}
                    disabled={loading}
                    style={{ marginBottom: SPACING.lg }}
                  />
                )}
                {showOtp && (
                  <>
                    <FormField
                      label="Verification code"
                      icon="key-outline"
                      value={login.otp}
                      onChangeText={login.setOtp}
                      optional={!changingPassword && isOptional(otpCredential)}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      autoCapitalize="none"
                      disabled={loading}
                      style={{ marginBottom: SPACING.md }}
                    />
                    <ActionButton
                      label={login.resendSeconds > 0 ? `Resend in ${login.resendSeconds}s` : 'Resend code'}
                      variant="outline"
                      disabled={loading || login.resendSeconds > 0}
                      onPress={login.resendOtp}
                      style={{ marginBottom: SPACING.lg }}
                    />
                  </>
                )}
                {changingPassword && (
                  <FormField
                    label="New password"
                    icon="lock-closed-outline"
                    value={login.newPassword}
                    onChangeText={login.setNewPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    disabled={loading}
                    style={{ marginBottom: SPACING.lg }}
                  />
                )}
              </ModuleCard>

              {!!login.error && (
                <StatusBanner
                  tone="error"
                  title="Sign-in could not finish"
                  message={login.error}
                  style={{ marginBottom: SPACING.lg }}
                />
              )}
              <ActionButton
                label={buttonLabel}
                icon="arrow-forward-outline"
                variant="accent"
                size="lg"
                loading={login.isLoading}
                disabled={loading}
                onPress={submit}
              />

              {changingPassword ? (
                <PressableScale
                  accessibilityLabel="Back to sign-in"
                  disabled={loading}
                  onPress={login.cancelPasswordMode}
                  style={{ alignItems: 'center', padding: SPACING.lg }}
                >
                  <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Back to sign-in</Text>
                </PressableScale>
              ) : (
                <>
                  {login.flow?.capabilities?.canCreatePassword && (
                    <PressableScale
                      accessibilityLabel="Create a password"
                      disabled={loading}
                      onPress={login.startCreatePassword}
                      style={{ alignItems: 'center', padding: SPACING.md }}
                    >
                      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Create a password</Text>
                    </PressableScale>
                  )}
                  {login.flow?.capabilities?.canResetPassword && (
                    <PressableScale
                      accessibilityLabel="Forgot password?"
                      disabled={loading}
                      onPress={login.startResetPassword}
                      style={{ alignItems: 'center', padding: SPACING.md }}
                    >
                      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Forgot password?</Text>
                    </PressableScale>
                  )}
                </>
              )}
            </>
          )}

          <ActionButton
            label="Scan QR code"
            icon="qr-code-outline"
            variant="outline"
            size="lg"
            disabled={loading}
            style={{ marginTop: SPACING.md }}
            onPress={() => navigation.navigate('Qrscan')}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function MobileLogin() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  if (isMobileAuthAvailable()) return <MobileLoginForm />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary, padding: SPACING.lg }}>
      <StatusBanner tone="info" title="Use your QR code" message="Mobile sign-in is available in the latest app build." />
      <ActionButton
        label="Scan QR code"
        icon="qr-code-outline"
        style={{ marginTop: SPACING.lg }}
        onPress={() => navigation.navigate('Qrscan')}
      />
    </SafeAreaView>
  );
}

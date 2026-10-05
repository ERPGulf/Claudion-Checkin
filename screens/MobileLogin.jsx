import React from 'react';
import {
  ActivityIndicator,
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { BUILD_TAG, ICON, RADIUS, SPACING, TYPO } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import useMobileLogin from '../hooks/useMobileLogin';
import ActionButton from '../components/common/ActionButton';
import Card from '../components/common/Card';
import FormField from '../components/common/FormField';
import OrDivider from '../components/common/OrDivider';
import PressableScale from '../components/common/PressableScale';
import StatusBanner from '../components/common/StatusBanner';
import { BrandMark } from '../components/Welcome';
import { isMobileAuthAvailable } from '../utils/mobileAuthCrypto';

const isOptional = credential => credential?.requirement === 'optional';
const isEnabled = credential =>
  !!credential && credential.requirement !== 'disabled';
const DISCOVERY_OPTIONS = [
  ['company', 'Company code'],
  ['server', 'Server address'],
];

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
  const discovery = login.discovery === 'server' ? 'server' : 'company';
  const resendDisabled = loading || login.resendSeconds > 0;
  const title = changingPassword
    ? login.passwordMode === 'create' ? 'Create a password' : 'Reset password'
    : 'Sign in with mobile number';
  const subtitle = changingPassword
    ? 'Enter the code we sent and choose a new password.'
    : login.flow
      // A code sent for the password panel must not caption a password-only step.
      ? login.otpSent && showOtp
        ? `We sent a verification code to ${login.mobileNumber}.`
        : 'Enter your details to finish signing in.'
      : login.backendUrl
        ? 'Enter the mobile number registered with your company.'
        : discovery === 'server'
          ? "Enter your company's server address and the mobile number registered with your company."
          : 'Enter your company code and the mobile number registered with your company.';
  const submit = changingPassword
    ? login.savePassword
    : login.flow ? login.complete : login.begin;
  const buttonLabel = changingPassword
    ? 'Save password'
    : login.flow ? 'Sign in' : 'Continue';
  // Not marked optional: it only counts once a password has been typed.
  const confirmField = (
    <FormField
      label="Confirm password"
      icon="lock-closed-outline"
      placeholder="Re-enter the password"
      value={login.confirmPassword}
      onChangeText={login.setConfirmPassword}
      secureTextEntry
      autoCapitalize="none"
      autoComplete="new-password"
      textContentType="newPassword"
      disabled={loading}
    />
  );
  const link = (label, onPress) => (
    <PressableScale
      accessibilityLabel={label}
      disabled={loading}
      accessibilityState={{ disabled: loading }}
      onPress={onPress}
      style={{ padding: SPACING.md }}
    >
      <Text style={{ ...TYPO.subhead, color: colors.accentText }}>{label}</Text>
    </PressableScale>
  );

  // Same rhythm as LoginModern: wordmark → title → form → actions, with the
  // slack split above and below so the block sits just above centre.
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
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.xl,
            paddingBottom: SPACING.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flex: 0.55 }} />

          <View style={{ alignItems: 'center' }}>
            <BrandMark width={124} />
            <Text
              accessibilityRole="header"
              style={{ ...TYPO.title2, color: colors.textPrimary, textAlign: 'center', marginTop: SPACING.xxl }}
            >
              {title}
            </Text>
            <Text
              style={{ ...TYPO.body, color: colors.textSecondary, textAlign: 'center', marginTop: SPACING.sm, maxWidth: 320 }}
            >
              {subtitle}
            </Text>
          </View>

          <View style={{ height: SPACING.xxl }} />

          {login.isHydrating ? (
            <ActivityIndicator accessibilityLabel="Loading sign-in" color={colors.textMuted} />
          ) : (
            <>
              <Card padded style={{ gap: SPACING.lg }}>
                {login.backendUrl ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: RADIUS.md,
                        backgroundColor: colors.iconBackground,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginEnd: SPACING.md,
                      }}
                    >
                      <Ionicons name="business-outline" size={ICON.md} color={colors.textPrimary} />
                    </View>
                    <Text style={{ ...TYPO.headline, color: colors.textPrimary, flex: 1 }}>Company selected</Text>
                    <PressableScale
                      accessibilityLabel="Change company"
                      disabled={loading}
                      accessibilityState={{ disabled: loading }}
                      onPress={login.changeCompany}
                      style={{ paddingVertical: SPACING.sm, paddingStart: SPACING.md }}
                    >
                      <Text style={{ ...TYPO.subhead, color: colors.accentText }}>Change</Text>
                    </PressableScale>
                  </View>
                ) : (
                  // The segment names the field below it, so the field drops its
                  // own label rather than repeat it.
                  <View style={{ gap: SPACING.md }}>
                    <View
                      accessibilityRole="tablist"
                      style={{
                        flexDirection: 'row',
                        padding: 3,
                        borderRadius: RADIUS.md,
                        backgroundColor: colors.surfaceSecondary,
                      }}
                    >
                      {DISCOVERY_OPTIONS.map(([mode, label]) => {
                        const selected = discovery === mode;
                        return (
                          <PressableScale
                            key={mode}
                            accessibilityRole="tab"
                            accessibilityLabel={`Use ${label.toLowerCase()}`}
                            accessibilityState={{ selected, disabled: loading }}
                            disabled={loading}
                            hitSlop={0}
                            onPress={() => login.setDiscovery(mode)}
                            style={{
                              flex: 1,
                              minHeight: 38,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: RADIUS.sm,
                              borderWidth: 1,
                              borderColor: selected ? colors.cardBorder : 'transparent',
                              backgroundColor: selected ? colors.cardBackground : 'transparent',
                            }}
                          >
                            <Text
                              style={{
                                ...TYPO.subhead,
                                fontWeight: selected ? '600' : '500',
                                color: selected ? colors.textPrimary : colors.textSecondary,
                              }}
                            >
                              {label}
                            </Text>
                          </PressableScale>
                        );
                      })}
                    </View>
                    {discovery === 'server' ? (
                      <FormField
                        accessibilityLabel="Server address"
                        icon="globe-outline"
                        placeholder="erp.yourcompany.com"
                        value={login.serverAddress}
                        onChangeText={login.setServerAddress}
                        errorText={login.serverAddressError}
                        disabled={loading}
                        keyboardType="url"
                        textContentType="URL"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        returnKeyType="next"
                      />
                    ) : (
                      <FormField
                        accessibilityLabel="Company code"
                        icon="business-outline"
                        placeholder="Enter company code"
                        value={login.companyCode}
                        onChangeText={login.setCompanyCode}
                        errorText={login.companyCodeError}
                        disabled={loading}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        returnKeyType="next"
                      />
                    )}
                  </View>
                )}
                <FormField
                  label="Mobile number"
                  icon="call-outline"
                  placeholder="Enter mobile number"
                  value={login.mobileNumber}
                  onChangeText={login.setMobileNumber}
                  errorText={login.mobileNumberError}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  autoCapitalize="none"
                  disabled={loading}
                />
                {!changingPassword && isEnabled(passwordCredential) && (
                  <FormField
                    label={creatingFlowPassword ? 'New password' : 'Password'}
                    icon="lock-closed-outline"
                    placeholder={creatingFlowPassword ? 'At least 8 characters' : 'Enter password'}
                    value={login.password}
                    onChangeText={login.setPassword}
                    optional={isOptional(passwordCredential)}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete={creatingFlowPassword ? 'new-password' : 'password'}
                    textContentType={creatingFlowPassword ? 'newPassword' : 'password'}
                    disabled={loading}
                  />
                )}
                {!changingPassword && creatingFlowPassword && confirmField}
                {showOtp && (
                  <View>
                    <FormField
                      label="Verification code"
                      icon="key-outline"
                      placeholder="Enter code"
                      value={login.otp}
                      onChangeText={login.setOtp}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      autoCapitalize="none"
                      disabled={loading}
                    />
                    <PressableScale
                      accessibilityLabel={login.resendSeconds > 0 ? `Resend in ${login.resendSeconds}s` : 'Resend code'}
                      disabled={resendDisabled}
                      accessibilityState={{ disabled: resendDisabled }}
                      onPress={login.resendOtp}
                      style={{ alignSelf: 'flex-end', paddingTop: SPACING.sm, paddingStart: SPACING.md }}
                    >
                      <Text style={{ ...TYPO.subhead, color: resendDisabled ? colors.textMuted : colors.accentText }}>
                        {login.resendSeconds > 0 ? `Resend in ${login.resendSeconds}s` : 'Resend code'}
                      </Text>
                    </PressableScale>
                  </View>
                )}
                {changingPassword && (
                  <>
                    <FormField
                      label="New password"
                      icon="lock-closed-outline"
                      placeholder="At least 8 characters"
                      value={login.newPassword}
                      onChangeText={login.setNewPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete="new-password"
                      textContentType="newPassword"
                      disabled={loading}
                    />
                    {confirmField}
                  </>
                )}
              </Card>

              {!!login.error && (
                <StatusBanner
                  tone="error"
                  title="Sign-in could not finish"
                  message={login.error}
                  style={{ marginTop: SPACING.lg }}
                />
              )}

              <View style={{ height: SPACING.xl }} />

              <ActionButton
                label={buttonLabel}
                icon={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'}
                variant="accent"
                size="lg"
                loading={login.isLoading}
                disabled={loading}
                onPress={submit}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
                {changingPassword
                  ? link('Back to sign-in', login.cancelPasswordMode)
                  : (
                    <>
                      {login.canCreatePassword && link('Create a password', login.startCreatePassword)}
                      {login.canResetPassword && link('Forgot password?', login.startResetPassword)}
                    </>
                  )}
              </View>
            </>
          )}

          <OrDivider style={{ marginVertical: SPACING.lg }} />
          <ActionButton
            label="Scan QR code"
            icon="qr-code-outline"
            variant="outline"
            size="lg"
            disabled={loading}
            onPress={() => navigation.navigate('Qrscan')}
          />

          <View style={{ flex: 1, minHeight: SPACING.xl }} />

          <Text style={{ ...TYPO.caption2, color: colors.textMuted, textAlign: 'center' }}>
            {BUILD_TAG}
          </Text>
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

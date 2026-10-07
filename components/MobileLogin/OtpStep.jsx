import React from 'react';
import { I18nManager, Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function OtpStep() {
  const { login } = useMobileLoginFlow();
  const { colors } = useAppTheme();
  const busy = login.isLoading || login.isHydrating;
  const resendDisabled = busy || login.resendSeconds > 0;
  const passwordFollows = login.passwordMode || (
    login.flow?.action === 'SIGN_UP' && login.flow?.credentials?.password?.requirement !== 'disabled'
  );
  return (
    <AuthStepLayout
      title={mobileLoginCopy('otpTitle')}
      subtitle={mobileLoginCopy(login.otpSent ? 'otpSubtitle' : 'otpNotSent', login.mobileNumber)}
    >
      <View style={{ gap: SPACING.md }}>
        <FormField
          label={mobileLoginCopy('verificationCode')}
          icon="key-outline"
          placeholder={mobileLoginCopy('codePlaceholder')}
          value={login.otp}
          onChangeText={login.setOtp}
          errorText={login.otpError}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          returnKeyType="done"
          align={I18nManager.isRTL ? 'right' : 'left'}
        />
        {!!passwordFollows && <Text style={{ ...TYPO.caption, color: colors.textMuted, textAlign: I18nManager.isRTL ? 'right' : 'left' }}>{mobileLoginCopy(login.passwordMode ? 'recoveryOtpHint' : 'signupOtpHint')}</Text>}
      </View>
      <ActionButton label={mobileLoginCopy('verifyCode')} variant="accent" size="lg" loading={login.isLoading} disabled={busy || !login.otp?.trim()} onPress={login.submitOtp} />
      <ActionButton
        label={mobileLoginCopy(login.resendSeconds > 0 ? 'resendSeconds' : 'resendCode', login.resendSeconds)}
        variant="outline"
        size="lg"
        disabled={resendDisabled}
        onPress={login.resendOtp}
      />
      {login.canCreatePassword && !login.passwordMode && <ActionButton label={mobileLoginCopy('createTitle')} icon="lock-closed-outline" variant="outline" size="lg" disabled={busy} onPress={login.startCreatePassword} />}
      {login.canResetPassword && !login.passwordMode && <ActionButton label={mobileLoginCopy('forgotPassword')} variant="outline" size="lg" disabled={busy} onPress={login.startResetPassword} />}
    </AuthStepLayout>
  );
}

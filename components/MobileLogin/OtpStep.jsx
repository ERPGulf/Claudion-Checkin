import React from 'react';
import { I18nManager, Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout, { TextAction } from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function OtpStep() {
  const { login } = useMobileLoginFlow();
  const { colors } = useAppTheme();
  const busy = login.isLoading || login.isHydrating;
  const canSubmit = !busy && !!login.otp?.trim();
  const submit = () => { if (canSubmit) login.submitOtp(); };
  const resendDisabled = busy || login.resendSeconds > 0;
  const passwordFollows = login.passwordMode || (
    login.flow?.action === 'SIGN_UP' && login.flow?.credentials?.password?.requirement !== 'disabled'
  );
  const showCreate = login.canCreatePassword && !login.passwordMode;
  const showReset = login.canResetPassword && !login.passwordMode;
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
          // Keyboard up on arrival, so the SMS code suggestion is one tap away.
          autoFocus
          disabled={busy}
          returnKeyType="done"
          onSubmitEditing={submit}
          align={I18nManager.isRTL ? 'right' : 'left'}
        />
        {!!passwordFollows && <Text style={{ ...TYPO.caption, color: colors.textMuted, textAlign: I18nManager.isRTL ? 'right' : 'left' }}>{mobileLoginCopy(login.passwordMode ? 'recoveryOtpHint' : 'signupOtpHint')}</Text>}
        <TextAction
          label={mobileLoginCopy(login.resendSeconds > 0 ? 'resendSeconds' : 'resendCode', login.resendSeconds)}
          disabled={resendDisabled}
          onPress={login.resendOtp}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
        />
      </View>
      <ActionButton label={mobileLoginCopy('verifyCode')} variant="accent" size="lg" loading={login.isLoading} disabled={!canSubmit} onPress={login.submitOtp} />
      {(showCreate || showReset) && (
        <View>
          {showCreate && <TextAction label={mobileLoginCopy('createTitle')} disabled={busy} onPress={login.startCreatePassword} />}
          {showReset && <TextAction label={mobileLoginCopy('forgotPassword')} disabled={busy} onPress={login.startResetPassword} />}
        </View>
      )}
    </AuthStepLayout>
  );
}

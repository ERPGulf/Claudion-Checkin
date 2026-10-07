import React from 'react';
import { I18nManager } from 'react-native';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function PasswordSignInStep() {
  const { login } = useMobileLoginFlow();
  const busy = login.isLoading || login.isHydrating;
  const needsOtp = login.flow?.credentials?.otp?.requirement && login.flow.credentials.otp.requirement !== 'disabled';
  return (
    <AuthStepLayout title={mobileLoginCopy('passwordTitle')} subtitle={mobileLoginCopy('passwordSubtitle', login.mobileNumber)}>
      <FormField
        label={mobileLoginCopy('password')}
        icon="lock-closed-outline"
        placeholder={mobileLoginCopy('passwordPlaceholder')}
        value={login.password}
        onChangeText={login.setPassword}
        errorText={login.passwordError}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        disabled={busy}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <ActionButton label={mobileLoginCopy(needsOtp ? 'continue' : 'signIn')} variant="accent" size="lg" loading={login.isLoading} disabled={busy || !login.password?.trim()} onPress={login.continuePasswordSignIn} />
      {login.canResetPassword && <ActionButton label={mobileLoginCopy('forgotPassword')} variant="outline" size="lg" disabled={busy} onPress={login.startResetPassword} />}
      {login.canCreatePassword && <ActionButton label={mobileLoginCopy('createTitle')} variant="outline" size="lg" disabled={busy} onPress={login.startCreatePassword} />}
    </AuthStepLayout>
  );
}

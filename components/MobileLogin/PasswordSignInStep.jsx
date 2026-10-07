import React from 'react';
import { I18nManager, View } from 'react-native';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout, { TextAction } from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function PasswordSignInStep() {
  const { login } = useMobileLoginFlow();
  const busy = login.isLoading || login.isHydrating;
  const canSubmit = !busy && !!login.password?.trim();
  const submit = () => { if (canSubmit) login.continuePasswordSignIn(); };
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
        autoFocus
        disabled={busy}
        returnKeyType="go"
        onSubmitEditing={submit}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <ActionButton label={mobileLoginCopy(needsOtp ? 'continue' : 'signIn')} variant="accent" size="lg" loading={login.isLoading} disabled={!canSubmit} onPress={login.continuePasswordSignIn} />
      {(login.canResetPassword || login.canCreatePassword) && (
        <View>
          {login.canResetPassword && <TextAction label={mobileLoginCopy('forgotPassword')} disabled={busy} onPress={login.startResetPassword} />}
          {login.canCreatePassword && <TextAction label={mobileLoginCopy('createTitle')} disabled={busy} onPress={login.startCreatePassword} />}
        </View>
      )}
    </AuthStepLayout>
  );
}

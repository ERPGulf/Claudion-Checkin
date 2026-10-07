import React from 'react';
import { I18nManager } from 'react-native';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function PasswordCreateStep() {
  const { login } = useMobileLoginFlow();
  const busy = login.isLoading || login.isHydrating;
  const optional = login.step === 'PASSWORD_OPTION';
  const resetting = login.passwordMode === 'reset';
  const title = resetting ? 'resetTitle' : optional ? 'secureTitle' : 'createTitle';
  const subtitle = resetting ? 'resetSubtitle' : login.passwordMode ? 'recoveryCreateSubtitle' : optional ? 'secureSubtitle' : 'createSubtitle';
  return (
    <AuthStepLayout title={mobileLoginCopy(title)} subtitle={mobileLoginCopy(subtitle)}>
      <FormField
        label={mobileLoginCopy('newPassword')}
        icon="lock-closed-outline"
        placeholder={mobileLoginCopy('passwordMinimum')}
        value={login.newPassword}
        onChangeText={login.setNewPassword}
        errorText={login.newPasswordError}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        disabled={busy}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <FormField
        label={mobileLoginCopy('confirmPassword')}
        icon="lock-closed-outline"
        placeholder={mobileLoginCopy('confirmPlaceholder')}
        value={login.confirmPassword}
        onChangeText={login.setConfirmPassword}
        errorText={login.confirmPasswordError}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        disabled={busy}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <ActionButton label={mobileLoginCopy(resetting ? 'resetTitle' : 'createPassword')} variant="accent" size="lg" loading={login.isLoading} disabled={busy || !login.isNewPasswordValid} onPress={login.submitNewPassword} />
      {optional && <ActionButton label={mobileLoginCopy('skipPassword')} variant="outline" size="lg" disabled={busy} onPress={login.skipPassword} />}
    </AuthStepLayout>
  );
}

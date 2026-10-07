import React, { useRef, useState } from 'react';
import { I18nManager } from 'react-native';
import ActionButton from '../common/ActionButton';
import FormField from '../common/FormField';
import AuthStepLayout from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

export default function PasswordCreateStep() {
  const { login } = useMobileLoginFlow();
  const confirmRef = useRef(null);
  const [leftNew, setLeftNew] = useState(false);
  const [leftConfirm, setLeftConfirm] = useState(false);
  const busy = login.isLoading || login.isHydrating;
  const canSubmit = !busy && login.isNewPasswordValid;
  const submit = () => { if (canSubmit) login.submitNewPassword(); };
  const optional = login.step === 'PASSWORD_OPTION';
  const resetting = login.passwordMode === 'reset';
  const title = resetting ? 'resetTitle' : optional ? 'secureTitle' : 'createTitle';
  const subtitle = resetting ? 'resetSubtitle' : login.passwordMode ? 'recoveryCreateSubtitle' : optional ? 'secureSubtitle' : 'createSubtitle';
  // Draft rules wait until the field is left (or the confirmation is as long
  // as the password), so the first keystroke is not met with red. An empty
  // field's error can only come from a submit or the server: shown at once.
  const newPasswordError = leftNew || !login.newPassword ? login.newPasswordError : undefined;
  const confirmPasswordError = leftConfirm || !login.confirmPassword || login.confirmPassword.length >= login.newPassword.length
    ? login.confirmPasswordError
    : undefined;
  return (
    <AuthStepLayout title={mobileLoginCopy(title)} subtitle={mobileLoginCopy(subtitle)}>
      <FormField
        label={mobileLoginCopy('newPassword')}
        icon="lock-closed-outline"
        placeholder={mobileLoginCopy('passwordMinimum')}
        value={login.newPassword}
        onChangeText={login.setNewPassword}
        onBlur={() => setLeftNew(true)}
        errorText={newPasswordError}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        // Not when skipping is offered: the keyboard would cover that choice.
        autoFocus={!optional}
        disabled={busy}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmRef.current?.focus()}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <FormField
        ref={confirmRef}
        label={mobileLoginCopy('confirmPassword')}
        icon="lock-closed-outline"
        placeholder={mobileLoginCopy('confirmPlaceholder')}
        value={login.confirmPassword}
        onChangeText={login.setConfirmPassword}
        onBlur={() => setLeftConfirm(true)}
        errorText={confirmPasswordError}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        disabled={busy}
        returnKeyType="go"
        onSubmitEditing={submit}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <ActionButton label={mobileLoginCopy(resetting ? 'resetTitle' : 'createPassword')} variant="accent" size="lg" loading={login.isLoading} disabled={!canSubmit} onPress={login.submitNewPassword} />
      {optional && <ActionButton label={mobileLoginCopy('skipPassword')} variant="outline" size="lg" disabled={busy} onPress={login.skipPassword} />}
    </AuthStepLayout>
  );
}

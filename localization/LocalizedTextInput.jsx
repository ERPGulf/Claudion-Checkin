/* eslint-disable react/prop-types */
import React from 'react';
import { TextInput } from 'react-native';
import { useTranslation } from './index';
import { isRtlText } from '../utils/textDirection';

/** Cursor and copy/paste values stay unmodified; machine credentials always use LTR. */
export default function LocalizedTextInput({ style, ...props }) {
  const { isRTL } = useTranslation();
  const machine = props.secureTextEntry ||
    ['email-address', 'url', 'phone-pad', 'number-pad', 'numeric', 'decimal-pad'].includes(props.keyboardType) ||
    ['username', 'password', 'newPassword', 'oneTimeCode', 'telephoneNumber', 'emailAddress', 'URL'].includes(props.textContentType) ||
    ['tel', 'email', 'url', 'numeric', 'decimal'].includes(props.inputMode) ||
    ['username', 'password', 'new-password', 'current-password', 'sms-otp', 'one-time-code', 'email', 'tel'].includes(props.autoComplete);
  const rtlText = props.value ? isRtlText(props.value) : isRTL;
  return <TextInput {...props} style={[
    { textAlign: rtlText ? 'right' : 'left', writingDirection: 'auto', ...(isRTL ? { letterSpacing: 0, includeFontPadding: true } : null) },
    style,
    // Text values keep physical alignment independent of the surrounding
    // control row. This does not reverse or insert characters into the value.
    { direction: 'ltr' },
    machine ? { textAlign: 'left', writingDirection: 'ltr' } : null,
  ]} />;
}

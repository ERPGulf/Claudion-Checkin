/* eslint-disable react/prop-types */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from './index';

/** Locale-aware typography; business/server text remains untouched. */
export default function LocalizedText({ style, ...props }) {
  const { isRTL, language } = useTranslation();
  const flattened = StyleSheet.flatten(style) || {};
  // RN resolves left/right alignment against the Yoga layout direction. Our
  // callers describe physical alignment (including script-aware server text),
  // so convert it once here instead of mirroring Arabic text a second time.
  const physicalAlign = flattened.textAlign || (isRTL ? 'right' : 'left');
  const textAlign = isRTL && ['left', 'right'].includes(physicalAlign)
    ? (physicalAlign === 'left' ? 'right' : 'left')
    : physicalAlign;
  const arabicType = isRTL ? {
    letterSpacing: 0,
    includeFontPadding: true,
    ...(flattened.fontSize ? { lineHeight: Math.max(flattened.lineHeight || 0, Math.ceil(flattened.fontSize * 1.5)) } : null),
  } : null;
  return <Text {...props} accessibilityLanguage={language} style={StyleSheet.flatten([
    { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' },
    style, arabicType, { textAlign },
  ])} />;
}

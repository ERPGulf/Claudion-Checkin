import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { isolateBidi, useTranslation } from '../../localization';
import Text from '../../localization/LocalizedText';
import { describeAuthFooter } from '../../utils/authFooter';
import LanguageSetting from '../settings/LanguageSetting';

// Running-bundle metadata is immutable until the next app/OTA launch. Keep
// translation out of this snapshot so mounted footers still change language.
const runningVersion = describeAuthFooter({
  nativeAppVersion: Constants.nativeAppVersion,
  expoVersion: Constants.expoConfig?.version,
  updateId: Updates.updateId,
  isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  isEnabled: Updates.isEnabled,
  isDevelopment: __DEV__,
});

/** Secondary language pill above noninteractive app/update metadata. */
export default function AuthFooter({ style }) {
  const { t, isRTL, direction } = useTranslation();
  const { colors } = useAppTheme();
  const version = isRTL ? isolateBidi(runningVersion.version) : runningVersion.version;
  const update = runningVersion.otaId
    ? (isRTL ? isolateBidi(runningVersion.otaId) : runningVersion.otaId)
    : t(runningVersion.otaLabelKey);

  return (
    <View testID="auth-footer" style={[{
      width: '100%',
      direction,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      // The pill sits inside a larger touch target; this leaves 11–13px of
      // visible separation between its surface and the version line.
      gap: SPACING.sm,
      marginTop: SPACING.md,
    }, style]}>
      <LanguageSetting compact />
      <Text style={{ ...TYPO.caption2, color: colors.textMuted, textAlign: 'center', maxWidth: '100%' }}>
        {t('Version {{version}} · OTA {{update}}', { version, update })}
      </Text>
    </View>
  );
}

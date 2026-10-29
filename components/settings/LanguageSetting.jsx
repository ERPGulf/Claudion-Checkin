import Text from '../../localization/LocalizedText';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, RADIUS, TYPO, ICON } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { setLanguage, useTranslation } from '../../localization';
import Card from '../common/Card';
import SectionHeader from '../common/SectionHeader';
import PressableScale from '../common/PressableScale';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'العربية' },
];

/** Device preference, independent of authentication and attendance storage. */
export default function LanguageSetting({ compact = false }) {
  const { t, language } = useTranslation();
  const { colors } = useAppTheme();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const choose = async code => {
    if (pending.current || code === language) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await setLanguage(code);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: compact ? SPACING.lg : SPACING.xxl }}>
      {!compact && <SectionHeader title={t('Language')} />}
      <Card padded>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Language')} style={{ flexDirection: 'row', gap: SPACING.sm }}>
          {LANGUAGES.map(option => {
            const selected = option.code === language;
            return (
              <PressableScale
                key={option.code}
                onPress={() => choose(option.code)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={option.name}
                accessibilityLanguage={option.code}
                accessibilityState={{ selected, disabled: busy, busy }}
                style={{ flex: 1, minHeight: 48, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: selected ? colors.accentBorder : colors.cardBorder, backgroundColor: selected ? colors.accentSurface : colors.iconBackground, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm }}
              >
                <Text style={{ ...TYPO.headline, color: selected ? colors.accentText : colors.textPrimary, flexShrink: 1 }}>{option.name}</Text>
                {selected && <Ionicons name="checkmark-circle-outline" size={ICON.sm} color={colors.accentText} />}
              </PressableScale>
            );
          })}
        </View>
        {error && <Text accessibilityLiveRegion="polite" style={{ ...TYPO.caption, color: colors.errorText, marginTop: SPACING.sm }}>{t('Could not save your language. Please try again.')}</Text>}
      </Card>
    </View>
  );
}

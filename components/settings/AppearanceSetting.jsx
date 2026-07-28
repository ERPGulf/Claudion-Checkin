import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from '../common/Card';
import PressableScale from '../common/PressableScale';
import SectionHeader from '../common/SectionHeader';
import SettingsRow from '../common/SettingsRow';

const OPTIONS = [
  { mode: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { mode: 'light', label: 'Light', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/**
 * Appearance picker.
 *
 * A three-way segmented control rather than a Switch, so "follow the system"
 * stays reachable — that is the default and what iOS users expect; a two-state
 * switch would force everyone to pin a palette.
 *
 * The control sits below its row rather than in the row's trailing slot because
 * three labelled segments need the full card width to stay legible.
 */
function AppearanceSetting() {
  const { colors, isDark, mode, setMode, darkAvailable } = useAppTheme();

  return (
    <>
      <SectionHeader
        title="Appearance"
        style={{ marginTop: SPACING.xxl }}
      />

      <Card>
        <SettingsRow
          icon={isDark ? 'moon' : 'contrast-outline'}
          iconTint={colors.accentSurface}
          iconColor={colors.primary2}
          title="Theme"
          description={
            darkAvailable
              ? 'Choose a palette, or follow your device setting.'
              : 'Turn on Modern UI to use dark mode.'
          }
        />

        <View
          accessibilityRole="radiogroup"
          style={{
            marginHorizontal: SPACING.lg,
            marginBottom: SPACING.lg,
            flexDirection: 'row',
            borderRadius: RADIUS.md,
            backgroundColor: colors.iconBackground,
            padding: 3,
            opacity: darkAvailable ? 1 : 0.5,
          }}
        >
          {OPTIONS.map(option => {
            const selected = option.mode === mode;

            return (
              <PressableScale
                key={option.mode}
                onPress={() => setMode(option.mode)}
                disabled={!darkAvailable}
                scaleTo={0.97}
                hitSlop={0}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !darkAvailable }}
                accessibilityLabel={`${option.label} appearance`}
                style={{
                  flex: 1,
                  height: 38,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: RADIUS.sm,
                  backgroundColor: selected
                    ? colors.cardBackground
                    : 'transparent',
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={15}
                  color={selected ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={{
                    ...TYPO.subhead,
                    marginStart: SPACING.xs + 2,
                    color: selected ? colors.textPrimary : colors.textMuted,
                    fontWeight: selected ? '600' : '500',
                  }}
                >
                  {option.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>
    </>
  );
}

export default AppearanceSetting;

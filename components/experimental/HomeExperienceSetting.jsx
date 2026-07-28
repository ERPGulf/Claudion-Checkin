import React from 'react';
import { Switch } from 'react-native';
import { SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useHomeExperience from '../../hooks/useHomeExperience';
import Card from '../common/Card';
import SectionHeader from '../common/SectionHeader';
import SettingsRow from '../common/SettingsRow';

/**
 * TEMPORARY — "Experimental UI" section for the Profile screen.
 *
 * Self-contained on purpose: Profile only imports and renders it, so removing
 * the experiment is one import plus one JSX line.
 *
 * The user-facing copy ("Experimental UI" / "Enable Modern UI") is a rename
 * only — the flag, its storage key and `useHomeExperience` are untouched, so
 * nothing behind this label changed.
 */
function HomeExperienceSetting() {
  const { enabled, setEnabled } = useHomeExperience();
  const { colors } = useAppTheme();

  return (
    <>
      <SectionHeader
        title="Experimental UI"
        subtitle="Preview work in progress. These options may change or disappear."
        style={{ marginTop: SPACING.xxl }}
      />

      <Card>
        <SettingsRow
          icon="flask-outline"
          iconTint={colors.accentSurface}
          iconColor={colors.primary2}
          title="Enable Modern UI"
          description="Switch between the classic interface and the redesigned modern interface."
        >
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: colors.primary2 }}
            accessibilityLabel="Enable Modern UI"
          />
        </SettingsRow>
      </Card>
    </>
  );
}

export default HomeExperienceSetting;

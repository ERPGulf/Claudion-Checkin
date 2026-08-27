import React from 'react';
import { SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useFeatureSettings from '../../hooks/useFeatureSettings';
import Card from '../common/Card';
import SectionHeader from '../common/SectionHeader';
import SettingsRow from '../common/SettingsRow';
import ActionButton from '../common/ActionButton';

/**
 * "Available features" — the manual retry for the feature-settings fetch.
 *
 * Deliberately quiet. Only shown when the last refresh failed, because when it
 * succeeds there is nothing here worth a row: which features an employee has is
 * an administrator's decision, not a setting they can change, and a permanent
 * "Features: loaded" row would be noise that invites support questions.
 *
 * A failure is worth surfacing, though: the app is running on whatever it last
 * knew (or on the optimistic defaults), and the employee should be able to ask
 * again without restarting. This is the retry the system deliberately does not
 * do on a loop — see components/FeatureSettingsBootstrap.jsx.
 */
function FeatureSettingsStatus() {
  const { colors } = useAppTheme();
  const { isError, isLoading, refresh, lastFetchedAt } = useFeatureSettings();

  if (!isError) return null;

  const description = lastFetchedAt
    ? "Couldn't check which features are available, so the app is using what it last knew. Nothing has been lost."
    : "Couldn't check which features are available. Some options may not appear correctly until this succeeds.";

  return (
    <>
      <SectionHeader
        title="Available features"
        style={{ marginTop: SPACING.xxl }}
      />

      <Card>
        <SettingsRow
          icon="cloud-offline-outline"
          iconTint={colors.errorSurface}
          iconColor={colors.errorText}
          title="Feature list out of date"
          description={description}
        />

        <ActionButton
          icon={isLoading ? 'sync-outline' : 'refresh-outline'}
          label={isLoading ? 'Checking' : 'Check again'}
          onPress={refresh}
          disabled={isLoading}
          style={{
            paddingHorizontal: SPACING.lg,
            marginHorizontal: SPACING.lg,
            marginBottom: SPACING.lg,
          }}
        />
      </Card>
    </>
  );
}

export default FeatureSettingsStatus;

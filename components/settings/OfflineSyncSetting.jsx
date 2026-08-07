import React from 'react';
import { Switch } from 'react-native';
import { SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useOfflineSyncAlerts from '../../hooks/useOfflineSyncAlerts';
import useOfflineStatus from '../../hooks/useOfflineStatus';
import Card from '../common/Card';
import SectionHeader from '../common/SectionHeader';
import SettingsRow from '../common/SettingsRow';

/**
 * "Offline sync alerts".
 *
 * Controls one banner and one banner only: "Waiting for your administrator".
 * It cannot hide "needs correction", and that limit is the point — a correction
 * is the employee's to act on, and a switch that could bury it would let
 * somebody lose a day's pay by tidying their own UI.
 *
 * The description changes with what is actually happening, because the honest
 * answer differs by tenant:
 *  - server has no offline endpoint → the banner is already suppressed
 *    automatically, so say so rather than implying the switch is doing it;
 *  - records are waiting → say how many, so turning it off is an informed
 *    choice rather than a blind one;
 *  - nothing waiting → explain what it would show.
 *
 * Records are never affected either way. The queue keeps every punch and keeps
 * retrying, and Attendance History shows each one with its chip regardless.
 */
function OfflineSyncSetting() {
  const { colors } = useAppTheme();
  const { enabled, setEnabled } = useOfflineSyncAlerts();
  const { blockedCount, rejectedCount, offlineSyncSupported } =
    useOfflineStatus();

  const unsupported = offlineSyncSupported === false;

  const description = unsupported
    ? "Your server doesn't support offline attendance, so these alerts are already hidden. Records are still saved and retried."
    : blockedCount > 0
      ? `${blockedCount} record${blockedCount === 1 ? '' : 's'} waiting on your administrator. Turning this off hides the banner — nothing is deleted.`
      : 'Show a banner when attendance is waiting on your administrator.';

  return (
    <>
      <SectionHeader title="Attendance sync" style={{ marginTop: SPACING.xxl }} />

      <Card>
        <SettingsRow
          icon="cloud-offline-outline"
          iconTint={colors.warningSurface}
          iconColor={colors.warningText}
          title="Offline sync alerts"
          description={description}
        >
          <Switch
            value={enabled && !unsupported}
            onValueChange={setEnabled}
            disabled={unsupported}
            trackColor={{ false: colors.iconBackground, true: colors.primary2 }}
            accessibilityLabel="Offline sync alerts"
          />
        </SettingsRow>

        {rejectedCount > 0 && (
          // Stated plainly so nobody flips the switch expecting silence and then
          // wonders why a red banner is still there.
          <SettingsRow
            icon="alert-circle-outline"
            iconTint={colors.errorSurface}
            iconColor={colors.errorText}
            title="Corrections are always shown"
            description={`${rejectedCount} record${
              rejectedCount === 1 ? '' : 's'
            } need your action. These stay visible even with alerts off.`}
          />
        )}
      </Card>
    </>
  );
}

export default OfflineSyncSetting;

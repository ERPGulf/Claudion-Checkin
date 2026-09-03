import { useEffect } from "react";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { selectFeatureSettings } from "../redux/Slices/FeatureSettingsSlice";
import {
  ATTENDANCE_FEATURES,
  isFeatureEnabled,
} from "../utils/featureSettings";
import {
  startBackgroundSync,
  stopBackgroundSync,
} from "../services/offline/BackgroundSyncManager";
import { setOfflineQueueingAllowed } from "../services/offline/offlineCapability";
import { applySessionOwner } from "../utils/attendanceSessionState";

/**
 * Runs the offline attendance machinery for the length of a session.
 *
 * Gated on login for the same reason `FcmBootstrap` is: every trigger it starts
 * ends in an authenticated request, and firing those with no token just burns
 * retries against 401s. Stopping on logout also detaches the NetInfo listener
 * and the interval, so a logged-out app is doing nothing in the background.
 *
 * `employeeCode` is what the cached configuration is fetched for, so the manager
 * is restarted when it arrives (it lands a moment after `isLoggedIn` on a fresh
 * QR provisioning) and whenever it changes.
 *
 * The queue itself is NOT cleared here, and no longer on logout either: a
 * queued punch is payroll data, and an expired token is not a reason to destroy
 * it. The concern that used to justify clearing — a punch syncing under the next
 * user's token — is handled by scoping the drain to the authenticated employee
 * (`syncPendingAttendance({ employeeId })`), which skips another employee's rows
 * instead of deleting them.
 *
 * This component also owns the one piece of teardown that genuinely is keyed to
 * *who* is logged in: the attendance session record. See `applySessionOwner`.
 */
export default function OfflineAttendanceBootstrap() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const employeeCode = useSelector(selectEmployeeCode);

  // `attendance_action.offline_attendance` is the administrator's switch, and it
  // governs exactly one thing: whether new punches may be *queued*. It used to
  // stop the sync manager outright, which meant a tenant with the switch off got
  // the worst of both — the punch path still queued (nothing told it not to) and
  // nothing was left running to deliver what it queued. Those rows sat in
  // `pending` forever, reading "Pending sync", with no attendance in the backend
  // and no error anywhere to explain it.
  //
  // So now: the switch is mirrored into `offlineCapability` so `submitAttendance`
  // refuses to queue, and the manager keeps running in drain-only mode so
  // anything already in the queue still gets delivered. Nothing is ever queued
  // that cannot be drained, and nothing queued is ever abandoned. Clearing the
  // queue happens on logout, not here.
  const offlineEnabled = useSelector(state =>
    isFeatureEnabled(
      selectFeatureSettings(state),
      ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE,
    ),
  );

  // The session record is a device-level key with no employee on it, so a
  // session left open by one employee would otherwise be inherited by the next
  // — and a geofence EXIT would close a stranger's shift. Deliberately NOT
  // gated on `offlineEnabled`: whose session it is has nothing to do with the
  // offline feature flag. Deliberately keyed on the employee changing rather
  // than on logout, because a session expiry is usually the same person coming
  // back mid-shift, and clearing then would lose the check-in that their
  // automatic check-out depends on.
  useEffect(() => {
    if (!isLoggedIn || !employeeCode) return;

    applySessionOwner(employeeCode)
      .then((cleared) => {
        if (cleared) {
          console.log(
            "[OfflineAttendanceBootstrap] Cleared a previous employee's attendance session",
          );
        }
      })
      .catch((error) => {
        console.log(
          "[OfflineAttendanceBootstrap] Session owner check failed:",
          error?.message,
        );
      });
  }, [isLoggedIn, employeeCode]);

  // Mirrored eagerly, and separately from the manager below, so the punch path
  // has the answer before any effect ordering or connectivity comes into it.
  useEffect(() => {
    setOfflineQueueingAllowed(isLoggedIn ? offlineEnabled : null);
  }, [isLoggedIn, offlineEnabled]);

  useEffect(() => {
    if (!isLoggedIn) {
      stopBackgroundSync();
      return undefined;
    }

    // `drainOnly` skips the configuration refresh — a tenant with the switch off
    // has no offline rules worth keeping current — while leaving the drain, the
    // NetInfo listener and the reconnect trigger in place for rows queued before
    // the switch was flipped. On an empty queue that costs one no-op timer.
    startBackgroundSync({
      employeeId: employeeCode,
      drainOnly: !offlineEnabled,
    });

    return () => stopBackgroundSync();
  }, [isLoggedIn, employeeCode, offlineEnabled]);

  return null;
}

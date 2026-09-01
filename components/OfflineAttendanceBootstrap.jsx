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

  // `attendance_action.offline_attendance` is the administrator's switch for the
  // whole mechanism. Turning it off stops the NetInfo listener and the interval
  // as well as the UI, so a tenant that does not want offline attendance is not
  // paying for its background work either. Anything already queued is left
  // alone — it is the employee's attendance, and it syncs if the feature comes
  // back on. Clearing the queue happens on logout, not here.
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

  useEffect(() => {
    if (!isLoggedIn || !offlineEnabled) {
      stopBackgroundSync();
      return undefined;
    }

    startBackgroundSync({ employeeId: employeeCode });

    return () => stopBackgroundSync();
  }, [isLoggedIn, employeeCode, offlineEnabled]);

  return null;
}

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
 * The queue itself is NOT cleared here — that happens in the logout path
 * alongside the session state, because a queued punch outliving its employee is
 * a punch that would sync under the next user's token.
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

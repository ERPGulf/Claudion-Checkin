import { useEffect } from "react";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
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

  useEffect(() => {
    if (!isLoggedIn) {
      stopBackgroundSync();
      return undefined;
    }

    startBackgroundSync({ employeeId: employeeCode });

    return () => stopBackgroundSync();
  }, [isLoggedIn, employeeCode]);

  return null;
}

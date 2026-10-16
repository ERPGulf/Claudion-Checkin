import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useDispatch, useSelector, useStore } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectBaseUrl, selectEmployeeCode } from "../redux/Slices/UserSlice";
import {
  selectAutoAttendanceUserEnabled, selectAutoAttendanceSyncRequestId, setAutoAttendanceGeotagging,
} from "../redux/Slices/AutoAttendanceSlice";
import { setCheckin, setCheckout } from "../redux/Slices/AttendanceSlice";
import * as Native from "../modules/expo-auto-attendance";
import { readAttendanceConfig, refreshAttendanceConfig } from "../services/offline/attendanceConfigCache";
import { addReconnectListener, fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { captureAttendanceQueueScope, assertAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { drainAutoAttendanceEvents, ingestPendingNativeEvents } from "../services/offline/AutoAttendanceEventProcessor";
import { reconcileAutoAttendanceRegistration } from "../utils/autoAttendanceRegistration";
import { isSessionActive, publishCurrentSession, TRANSITION_RESULT } from "../utils/attendanceSessionState";
import { presentLocalNotification } from "../services/notifications/localNotifications";
import { useFeatureEnabled } from "../hooks/useFeatureSettings";
import { ATTENDANCE_FEATURES } from "../utils/featureSettings";

/** Journal replay needs neither a fresh GPS fix nor permission to register again. */
export default function DurableAutoAttendanceBootstrap() {
  const dispatch = useDispatch();
  const store = useStore();
  const loggedIn = useSelector(selectIsLoggedIn);
  const employeeId = useSelector(selectEmployeeCode);
  const baseUrl = useSelector(selectBaseUrl);
  const enabled = useSelector(selectAutoAttendanceUserEnabled);
  const capabilityAllowed = useFeatureEnabled(ATTENDANCE_FEATURES.AUTO_ATTENDANCE);
  const syncRequestId = useSelector(selectAutoAttendanceSyncRequestId);
  const work = useRef(Promise.resolve());

  // Do not wait behind an in-flight employee refresh to stop monitoring after
  // settings revocation. Captured receipts remain durable and attributable.
  useEffect(() => {
    if (!capabilityAllowed) Native.stopGeofence().catch(() => {});
  }, [capabilityAllowed]);

  useEffect(() => {
    let cancelled = false;
    const report = (error) => {
      if (!cancelled) console.log("[AutoAttendance] Work retained", { code: error?.code });
    };
    const onTransition = async (result, scope) => {
      if (cancelled || !result?.session) return;
      await publishCurrentSession({
        assertCurrent: () => assertAttendanceQueueScope(scope),
        publish: current => {
          if (isSessionActive(current)) dispatch(setCheckin({ checkinTime: current.startedAt,
            sessionOrigin: current.origin, location: current.startedAt === result.session.startedAt &&
              current.committedAt === result.session.committedAt ? result.response?.location ?? null : store.getState().attendance.location }));
          else dispatch(setCheckout({ checkoutTime: current.endedAt }));
        },
      });
      if (result.status === TRANSITION_RESULT.COMPLETED && result.session.closedBy === "AUTO") {
        await presentLocalNotification({ title: result.queued ? "Checked out offline" : "Checked out",
          body: result.queued ? "Your automatic checkout is saved on this device and will synchronize when online."
            : "Your check-in was closed automatically after leaving the office.",
          data: { type: "auto-checkout", pendingSync: result.queued } });
      }
    };
    const run = ({ refresh = false } = {}) => {
      work.current = work.current.catch(() => {}).then(async () => {
        // Capture first, including after logout. Receipts keep their original owner.
        await ingestPendingNativeEvents();
        if (cancelled) return;
        if (!loggedIn || !employeeId || !capabilityAllowed) {
          await reconcileAutoAttendanceRegistration(null, null);
          return;
        }
        const scope = { ...await captureAttendanceQueueScope(employeeId), isCancelled: () => cancelled };
        let config = await readAttendanceConfig();
        await assertAttendanceQueueScope(scope);
        // Connected launch/foreground/reconnect refreshes authority before any
        // replay. Offline delivery uses the scoped cache without a network wait.
        if (refresh && await fetchShouldAttemptRequest()) {
          const result = await refreshAttendanceConfig(employeeId);
          await assertAttendanceQueueScope(scope);
          config = result.config;
        }
        if (config?.tenantKey !== scope.tenantKey || config?.employeeId !== scope.employeeId) {
          await reconcileAutoAttendanceRegistration(null, null);
          return;
        }
        dispatch(setAutoAttendanceGeotagging(config.rules?.geotagging));
        // New configuration may unblock receipts retained at initial hydration.
        if (enabled) await drainAutoAttendanceEvents({ scope, onTransition: result => onTransition(result, scope) });
        await reconcileAutoAttendanceRegistration(enabled ? scope : null, enabled ? config : null);
      }).catch(report);
      return work.current;
    };
    const subscriptions = [
      Native.addGeofenceEnterListener(() => { run(); }),
      Native.addGeofenceExitListener(() => { run(); }),
      Native.addErrorListener(() => { run(); }),
      AppState.addEventListener("change", state => { if (state === "active") run({ refresh: true }); }),
    ];
    const reconnect = addReconnectListener(() => { run({ refresh: true }); });
    const retry = setInterval(() => { run(); }, 60000);
    run({ refresh: true });
    return () => {
      cancelled = true;
      clearInterval(retry);
      reconnect();
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [loggedIn, employeeId, baseUrl, enabled, capabilityAllowed, syncRequestId, dispatch, store]);
  return null;
}

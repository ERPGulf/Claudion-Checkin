import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import {
  selectFeatureSettingsFetchedAt,
  selectFeatureSettingsHealth,
} from "../redux/Slices/FeatureSettingsSlice";
import useFeatureSettings from "../hooks/useFeatureSettings";
import { SETTINGS_STALE_AFTER_MS } from "../utils/featureSettings";
import { addReconnectListener } from "../services/offline/NetworkListener";

/**
 * How long a cached answer is good for before a foreground is worth a request.
 *
 * Not an expiry — a stale answer keeps being used, and is used forever if the
 * server is unreachable. This only decides when to spend a request, the same
 * arrangement `attendanceConfigCache.CONFIG_STALE_AFTER_MS` uses. Thirty minutes
 * means an administrator's change reaches an employee within one app switch,
 * without turning app-switching into a request generator.
 */
export { SETTINGS_STALE_AFTER_MS } from "../utils/featureSettings";

/**
 * Fetches feature settings once per session and refreshes them at sensible
 * lifecycle points. This is the only place in the app that calls the settings
 * endpoint — screens read the store.
 *
 * Follows the bootstrap-component convention already used by <FcmBootstrap>,
 * <AutoAttendanceBootstrap> and <OfflineAttendanceBootstrap>: mounted once under
 * the providers in App.js, renders nothing, gated on login because every request
 * it makes is authenticated.
 *
 *     login / employee code arrives
 *            ↓
 *     scope changed?  → drop the previous tenant's settings
 *            ↓
 *     fetch employee_checkin_setting
 *            ↓
 *     store (persisted by redux-persist)
 *            ↓
 *     foreground, if older than SETTINGS_STALE_AFTER_MS → refresh
 *     reconnect, unless the last answer is fresh → refresh
 *
 * The app is never blocked on this. The navigator renders immediately off
 * whatever is in the persisted store — the previous session's answer on a
 * relaunch, or the optimistic default on a first run — and re-renders if the
 * response changes anything. Blocking the splash on a settings call would mean a
 * tenant with a slow or missing endpoint could not open the app at all.
 *
 * There is no retry loop. A failure keeps the last known settings and waits for
 * the next natural trigger (a foreground, or the next launch); the Profile
 * screen offers a manual retry. Hammering an endpoint that is down would cost
 * battery and change nothing.
 */
export default function FeatureSettingsBootstrap() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const employeeCode = useSelector(selectEmployeeCode);
  const lastFetchedAt = useSelector(selectFeatureSettingsFetchedAt);
  const health = useSelector(selectFeatureSettingsHealth);

  const { refresh } = useFeatureSettings();

  // Read in the AppState handler without making it a dependency, so the
  // subscription is attached once per session rather than re-attached on every
  // fetch.
  const stateRef = useRef({ lastFetchedAt, health, refresh, isLoggedIn });
  stateRef.current = { lastFetchedAt, health, refresh, isLoggedIn };

  /* ---------------------------------------------------------------------
   * Scope changes: a different backend or a different employee.
   *
   * REVERT_ALL already clears this slice on logout. This covers the case it
   * cannot see — re-provisioning to another tenant by QR scan without an
   * intervening logout — where the persisted blob would otherwise be applied to
   * a backend it says nothing about.
   * ------------------------------------------------------------------- */
  // Scope is checked synchronously by selectors and at service execution time.
  // Do not invalidate in a separate async effect: it can erase a new request.

  /* ---------------------------------------------------------------------
   * Session start.
   *
   * `employeeCode` is in the dependencies because it lands a moment after
   * `isLoggedIn` on a fresh QR provisioning, and the scope is not resolvable
   * until it does — the same reason <OfflineAttendanceBootstrap> watches it.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!isLoggedIn) return;

    refresh();
  }, [isLoggedIn, employeeCode, refresh]);

  /* ---------------------------------------------------------------------
   * Foreground, throttled.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;

      const current = stateRef.current;
      if (!current.isLoggedIn) return;

      const age = current.lastFetchedAt
        ? Date.now() - current.lastFetchedAt
        : Infinity;

      if (age < SETTINGS_STALE_AFTER_MS) return;

      current.refresh();
    });

    return () => subscription.remove();
  }, [isLoggedIn]);

  /* ---------------------------------------------------------------------
   * Reconnect: a launch or refresh that failed offline leaves the last answer
   * stale until the next foreground, and automatic attendance and its
   * onboarding wait on a fresh one.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    return addReconnectListener(() => {
      const current = stateRef.current;
      if (current.isLoggedIn && (current.health === "stale" || current.health === "unavailable")) {
        current.refresh();
      }
    });
  }, [isLoggedIn]);

  return null;
}

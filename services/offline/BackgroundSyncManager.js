// src/services/offline/BackgroundSyncManager.js
import { AppState } from "react-native";
import { syncPendingAttendance } from "./AttendanceSyncService";
import {
  refreshAttendanceConfig,
  refreshAttendanceConfigIfStale,
} from "./attendanceConfigCache";
import {
  addReconnectListener,
  fetchIsOnline,
  startNetworkListener,
  stopNetworkListener,
} from "./NetworkListener";

/**
 * When the queue drains and when the cached configuration refreshes.
 *
 * Four triggers, all of them cheap because the work behind them is idempotent —
 * `syncPendingAttendance` collapses concurrent calls into one run and returns
 * immediately when nothing is due, and the config refresh is skipped while the
 * cache is fresh:
 *
 *  - **launch** — the app opens (or the OS relaunches it in the background for a
 *    geofence event, which is when the most valuable punches are queued)
 *  - **foreground** — returning from background, the moment a user is most
 *    likely to have walked back into signal
 *  - **reconnect** — NetInfo reports the connection restored
 *  - **interval** — a slow heartbeat while the app is open, which is the only
 *    thing that retires a row whose retry backoff expires while the user sits
 *    on one screen doing nothing
 *
 * There is no OS-level background task here. `expo-background-task` would be a
 * further native dependency, and the geofence relaunch already wakes JS at the
 * moments that matter for attendance.
 */

const LOG_PREFIX = "[BackgroundSyncManager]";

/**
 * Slow on purpose. The retry schedule (30s → 2m → 10m …) is what decides when a
 * row is next attempted; this only needs to tick often enough to notice. A fast
 * interval would just wake the radio to find nothing due.
 */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Foregrounding twice in quick succession should not mean two runs. */
const FOREGROUND_DEBOUNCE_MS = 3000;

let started = false;
let intervalId = null;
let appStateSubscription = null;
let removeReconnectListener = null;
let lastForegroundRun = 0;
let currentEmployeeId = null;

const runSync = (trigger) =>
  syncPendingAttendance({ trigger }).catch((error) => {
    console.log(`${LOG_PREFIX} Sync (${trigger}) failed:`, error?.message);
  });

/**
 * Keeps the offline rules current. Never throws and never damages a good cache
 * (see attendanceConfigCache), so it is safe on every trigger.
 */
const runConfigRefresh = async (trigger, { force = false } = {}) => {
  if (!currentEmployeeId) return;

  try {
    if (!(await fetchIsOnline())) return;

    const result = force
      ? await refreshAttendanceConfig(currentEmployeeId)
      : await refreshAttendanceConfigIfStale(currentEmployeeId);

    if (result.refreshed) {
      console.log(`${LOG_PREFIX} Config refreshed (${trigger})`);
    }
  } catch (error) {
    console.log(`${LOG_PREFIX} Config refresh (${trigger}) failed:`, error?.message);
  }
};

const handleAppStateChange = (nextState) => {
  if (nextState !== "active") return;

  const now = Date.now();
  if (now - lastForegroundRun < FOREGROUND_DEBOUNCE_MS) return;
  lastForegroundRun = now;

  runConfigRefresh("foreground");
  runSync("foreground");
};

const handleReconnect = () => {
  // The connection being *reported* back is not the same as it being usable, but
  // an early attempt costs one failed request and one backoff step, and waiting
  // costs the user a punch that looks stuck. Attempt it.
  runConfigRefresh("reconnect");
  runSync("reconnect");
};

/**
 * Starts every trigger. Idempotent — calling it again while running only
 * updates the employee the config refresh is for.
 *
 * @param {object} options
 * @param {string} options.employeeId whose configuration to keep cached
 * @returns {() => void} stop
 */
export const startBackgroundSync = ({ employeeId = null } = {}) => {
  currentEmployeeId = employeeId;

  if (started) return stopBackgroundSync;
  started = true;

  startNetworkListener();
  removeReconnectListener = addReconnectListener(handleReconnect);

  appStateSubscription = AppState.addEventListener(
    "change",
    handleAppStateChange,
  );

  intervalId = setInterval(() => {
    runConfigRefresh("interval");
    runSync("interval");
  }, SYNC_INTERVAL_MS);

  // Launch. The config refresh is forced here rather than staleness-gated: this
  // is the one moment we know the app is starting fresh, and a device that has
  // never cached anything cannot do offline attendance until it does.
  runConfigRefresh("launch", { force: true });
  runSync("launch");

  console.log(`${LOG_PREFIX} Started`, { employeeId });

  return stopBackgroundSync;
};

export const stopBackgroundSync = () => {
  if (!started) return;
  started = false;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  appStateSubscription?.remove?.();
  appStateSubscription = null;

  removeReconnectListener?.();
  removeReconnectListener = null;

  stopNetworkListener();
  currentEmployeeId = null;

  console.log(`${LOG_PREFIX} Stopped`);
};

export const isBackgroundSyncRunning = () => started;

/**
 * Pull-to-refresh: refresh the rules and drain the queue, and let the caller
 * await both. The other triggers are fire-and-forget; this one the user is
 * watching.
 */
export const syncNow = async ({ trigger = "pull-to-refresh" } = {}) => {
  await runConfigRefresh(trigger, { force: true });
  return syncPendingAttendance({ trigger });
};

export default {
  SYNC_INTERVAL_MS,
  isBackgroundSyncRunning,
  startBackgroundSync,
  stopBackgroundSync,
  syncNow,
};

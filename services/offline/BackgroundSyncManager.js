// src/services/offline/BackgroundSyncManager.js
import { AppState } from "react-native";
import { addTokenChangeListener } from "../api/apiClient";
import { FAILURE_CLASS } from "./AttendanceDatabase";
import { syncPendingAttendance } from "./AttendanceSyncService";
import { registerQueueDrainHandler } from "./AttendanceQueueService";
import {
  refreshAttendanceConfig,
  refreshAttendanceConfigIfStale,
} from "./attendanceConfigCache";
import {
  addReconnectListener,
  fetchShouldAttemptRequest,
  startNetworkListener,
  stopNetworkListener,
} from "./NetworkListener";

/**
 * When the queue drains and when the cached configuration refreshes.
 *
 * Five triggers, all of them cheap because the work behind them is idempotent —
 * `syncPendingAttendance` collapses concurrent calls into one run and returns
 * immediately when nothing is due, and the config refresh is skipped while the
 * cache is fresh:
 *
 *  - **launch** — the app opens (or the OS relaunches it in the background for a
 *    geofence event, which is when the most valuable punches are queued)
 *  - **foreground** — returning from background, the moment a user is most
 *    likely to have walked back into signal
 *  - **reconnect** — NetInfo reports the connection restored
 *  - **queued punch** — a punch just went into the queue, after a short delay
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
 * The heartbeat while the app is open.
 *
 * A minute, because the retry ladder is now measured in seconds and a five-minute
 * tick would be the thing deciding when a row is attempted rather than the
 * ladder. A tick with nothing due is a single indexed query and no request —
 * `syncPendingAttendance` returns before touching the network (see `hasWorkDue`)
 * — so the cost of asking often is close to nothing, and the cost of asking
 * rarely is a punch sitting on a working connection.
 *
 * Only while the app is in the foreground: this is a `setInterval`, and the OS
 * stops it with the JS context.
 */
export const SYNC_INTERVAL_MS = 60 * 1000;

/** Foregrounding twice in quick succession should not mean two runs. */
const FOREGROUND_DEBOUNCE_MS = 3000;

/**
 * How long after a punch is queued before the queue is drained.
 *
 * Almost immediate. A punch reaches the queue either because there was no
 * transport — in which case this drain finds none either and costs one query —
 * or because the real request was just attempted and failed, and three seconds
 * is long enough that an instant repeat of a failing request is not the first
 * thing the queue does. It is deliberately shorter than the ladder's own first
 * step: the point of this trigger is that a punch should not have to wait for a
 * schedule to notice it exists.
 */
export const QUEUE_KICK_DELAY_MS = 3 * 1000;

let started = false;
let intervalId = null;
let appStateSubscription = null;
let removeReconnectListener = null;
let removeTokenChangeListener = null;
let removeQueueDrainHandler = null;
let queueKickTimer = null;
let lastForegroundRun = 0;
let currentEmployeeId = null;
let drainOnlyMode = false;

/**
 * @param {string} trigger for the log
 * @param {object} [options]
 * @param {boolean} [options.wakeAllBlocked] ignore the blocked backoff, for the
 *        events that genuinely change whether a blocked row can now land
 * @param {string|null} [options.wakeFailureClass] narrow the wake to one class
 */
const runSync = (trigger, { wakeAllBlocked = false, wakeFailureClass = null } = {}) => {
  // No authenticated employee means no way to prove who a queued row belongs
  // to, and a row is uploaded under whatever token the device holds. Waiting is
  // free — `employeeCode` lands a moment after login and restarts this manager,
  // and the rows are kept, not dropped — whereas guessing files one employee's
  // attendance against another.
  if (!currentEmployeeId) {
    console.log(`${LOG_PREFIX} Sync (${trigger}) skipped: no authenticated employee`);
    return Promise.resolve();
  }

  return syncPendingAttendance({
    trigger,
    wakeAllBlocked,
    wakeFailureClass,
    employeeId: currentEmployeeId,
  }).catch((error) => {
    console.log(`${LOG_PREFIX} Sync (${trigger}) failed:`, error?.message);
  });
};

/**
 * Keeps the offline rules current. Never throws and never damages a good cache
 * (see attendanceConfigCache), so it is safe on every trigger.
 */
const runConfigRefresh = async (trigger, { force = false } = {}) => {
  if (!currentEmployeeId) return;
  // Drain-only: the tenant has offline attendance switched off, so there are no
  // offline rules to keep current — but rows queued before it was switched off
  // still have to be delivered. See startBackgroundSync.
  if (drainOnlyMode) return;

  try {
    // Attempt rather than trust: a network whose captive-portal probe fails
    // reports no internet indefinitely, and a device that never refreshes its
    // configuration cannot do offline attendance at all.
    if (!(await fetchShouldAttemptRequest())) return;

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

  // Foregrounding respects the blocked ladder. It happens dozens of times a day
  // and nothing about it suggests the server changed, so forcing every blocked
  // row awake here would be the "hammer the server" failure mode.
  runConfigRefresh("foreground");
  runSync("foreground");
};

const handleReconnect = () => {
  // The connection being *reported* back is not the same as it being usable, but
  // an early attempt costs one failed request and one backoff step, and waiting
  // costs the user a punch that looks stuck. Attempt it.
  //
  // Blocked rows are forced awake: a different network can mean a different
  // route to a different (working) host, and the employee has been waiting.
  runConfigRefresh("reconnect");
  runSync("reconnect", { wakeAllBlocked: true });
};

/**
 * A punch was just queued.
 *
 * One timer for a burst: a geofence EXIT and a tapped check-out arriving
 * together, or the several punches an employee makes while wondering why the
 * screen says offline, all collapse into the single drain that would have
 * handled them anyway.
 */
const handleQueuedPunch = () => {
  if (queueKickTimer) return;

  queueKickTimer = setTimeout(() => {
    queueKickTimer = null;
    runSync("queued-punch");
  }, QUEUE_KICK_DELAY_MS);
};

/**
 * A new access token is the one event that makes an auth-blocked row plausible
 * again, so those are forced awake immediately. Scoped to `AUTH` — a fresh token
 * says nothing about an endpoint that is still not deployed, and re-attempting
 * those here would just spend requests.
 */
const handleTokenChange = () => {
  runSync("token-refresh", {
    wakeAllBlocked: true,
    wakeFailureClass: FAILURE_CLASS.AUTH,
  });
};

/**
 * Starts every trigger. Idempotent — calling it again while running only
 * updates the employee the config refresh is for, and whether it is drain-only.
 *
 * @param {object} options
 * @param {string} options.employeeId whose configuration to keep cached
 * @param {boolean} [options.drainOnly] deliver what is already queued and
 *        nothing more — no configuration refresh. This is what the
 *        administrator's offline-attendance switch turns off, and the
 *        distinction matters: that switch decides whether new punches may be
 *        *queued*, and it was never a statement about whether punches already
 *        queued should be *delivered*. Stopping the manager outright on a
 *        disabled tenant left those rows in `pending` for good.
 * @returns {() => void} stop
 */
export const startBackgroundSync = ({
  employeeId = null,
  drainOnly = false,
} = {}) => {
  currentEmployeeId = employeeId;
  drainOnlyMode = drainOnly;

  if (started) return stopBackgroundSync;
  started = true;

  startNetworkListener();
  removeReconnectListener = addReconnectListener(handleReconnect);
  removeTokenChangeListener = addTokenChangeListener(handleTokenChange);
  removeQueueDrainHandler = registerQueueDrainHandler(handleQueuedPunch);

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
  //
  // Blocked rows are forced awake too. An app launch is the likeliest moment for
  // the world to have changed underneath a blocked record — the server upgraded
  // overnight, the endpoint got deployed, a permission was granted — and it is
  // also the guaranteed backstop if the device clock moved and left a
  // `nextAttemptAt` stranded in the future.
  runConfigRefresh("launch", { force: true });
  runSync("launch", { wakeAllBlocked: true });

  console.log(`${LOG_PREFIX} Started`, { employeeId, drainOnly });

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

  removeTokenChangeListener?.();
  removeTokenChangeListener = null;

  removeQueueDrainHandler?.();
  removeQueueDrainHandler = null;

  if (queueKickTimer) {
    clearTimeout(queueKickTimer);
    queueKickTimer = null;
  }

  stopNetworkListener();
  currentEmployeeId = null;
  drainOnlyMode = false;

  console.log(`${LOG_PREFIX} Stopped`);
};

export const isBackgroundSyncRunning = () => started;

/**
 * Pull-to-refresh: refresh the rules and drain the queue, and let the caller
 * await both. The other triggers are fire-and-forget; this one the user is
 * watching.
 */
export const syncNow = async ({
  trigger = "pull-to-refresh",
  employeeId = null,
} = {}) => {
  // `employeeId` overrides the manager's own idea of who is logged in, for
  // callers that know it independently. Without it a drain requested while the
  // manager is not running — the offline feature switched off, or the employee
  // code not yet through — would find no scope and refuse forever, which for
  // `reconcilePresence` would mean automatic check-in never resuming.
  const scope = employeeId || currentEmployeeId;

  await runConfigRefresh(trigger, { force: true });
  // An explicit pull is a person asking "is it done yet?", so every blocked row
  // is re-attempted regardless of its backoff. This is the closest thing to a
  // manual retry the design offers, and it is deliberately not a button.
  //
  // Scoped like every other trigger: a pull-to-refresh is still not permission
  // to upload somebody else's punches, and with nobody authenticated there is
  // no scope to apply. Shaped like a real (empty) run so the caller's
  // `await syncNow()` needs no special case.
  if (!scope) {
    console.log(`${LOG_PREFIX} Sync (${trigger}) skipped: no authenticated employee`);
    return { ran: false, reason: "no-employee", trigger };
  }

  return syncPendingAttendance({
    trigger,
    wakeAllBlocked: true,
    // Pending rows are made due as well, which the automatic triggers do not
    // do. The drain claims in order, so a single row mid-backoff holds back
    // every later punch — and a person pulling to refresh is asking about all
    // of them, not just the ones whose ladder happens to have elapsed.
    wakeAllPending: true,
    employeeId: scope,
  });
};

export default {
  QUEUE_KICK_DELAY_MS,
  SYNC_INTERVAL_MS,
  isBackgroundSyncRunning,
  startBackgroundSync,
  stopBackgroundSync,
  syncNow,
};

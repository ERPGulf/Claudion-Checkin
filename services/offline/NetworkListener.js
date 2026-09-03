// src/services/offline/NetworkListener.js
import NetInfo from "@react-native-community/netinfo";

/**
 * Connectivity, and the moment it comes back.
 *
 * Deliberately knows nothing about attendance, the queue or syncing — it reports
 * connectivity and fires callbacks. `BackgroundSyncManager` is what connects
 * "we're back online" to "drain the queue", which keeps this module free of the
 * import cycle that wiring it directly would create.
 *
 * Two questions, and they are NOT the same one:
 *
 *  - `isOnline()` — "is this connection usable?" Reachability wins when NetInfo
 *    has determined it, falling back to `isConnected` while it is still null. A
 *    phone on captive-portal hotel wifi reports `isConnected: true` and reaches
 *    nothing, and treating that as online makes every punch wait out a full
 *    request timeout before being queued — the employee waits, twice, at the
 *    door. This is the answer the UI shows and the door-side punch uses.
 *
 *  - `shouldAttemptRequest()` — "is it worth trying?" Transport only,
 *    reachability ignored. Every background path asks this one, because
 *    reachability is a probe that can be wrong for hours at a stretch and a
 *    background retry has no user waiting on it. See the note on that function.
 *
 * Getting the second one to also mean the first is what let a wrong probe
 * strand a day of attendance in the queue, so keep them apart.
 */

let currentState = {
  isConnected: true,
  isInternetReachable: null,
  type: "unknown",
};

let unsubscribe = null;
const reconnectListeners = new Set();
const changeListeners = new Set();

/** Reachability if NetInfo has determined it, connectivity otherwise. */
export const isStateOnline = (state) => {
  if (!state) return false;
  if (state.isInternetReachable === false) return false;
  if (state.isInternetReachable === true) return true;
  return !!state.isConnected;
};

/** Last known connectivity. Synchronous — safe inside a hot path. */
export const isOnline = () => isStateOnline(currentState);

/** The full last-known state, for logging and diagnostics. */
export const getNetworkState = () => ({ ...currentState });

/**
 * Whether it is worth *attempting* a request — a deliberately weaker question
 * than `isOnline()`, and the one every background path must ask.
 *
 * `isInternetReachable` is a probe result, not a fact. On Android it is
 * `NET_CAPABILITY_VALIDATED`: the OS captive-portal check, which fails on any
 * network that blocks Android's connectivity-check endpoint — site wifi behind a
 * corporate firewall being the ordinary case — and then stays false for as long
 * as the device is on that network. On such a network every request the app
 * makes succeeds while NetInfo insists there is no internet.
 *
 * Letting that verdict decide whether to *try* is what turned a wrong probe into
 * lost payroll: punches were queued, the drain then declined to run because the
 * same probe said offline, and the rows sat in `pending` — "Pending sync" in
 * history, nothing in the backend — indefinitely. Nothing ever reached the
 * server, so nothing was ever classified, so nothing escalated.
 *
 * So this asks only: is there a transport at all? Being wrong here costs one
 * failed request and one backoff step. Being wrong the other way costs a day's
 * attendance.
 */
export const shouldAttemptRequest = (state = currentState) => {
  if (!state) return false;
  // Aeroplane mode and a genuinely down interface. No transport means no
  // request, and skipping it is what keeps a punch at the door instant.
  if (state.type === "none") return false;
  return state.isConnected !== false;
};

/** Refreshes the cached state from NetInfo, keeping the last one on failure. */
const refreshState = async () => {
  try {
    const state = await NetInfo.fetch();
    currentState = {
      isConnected: !!state?.isConnected,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? "unknown",
    };
  } catch {
    // The cached state stands — a failed fetch is not evidence of anything.
  }

  return currentState;
};

/**
 * Asks NetInfo directly rather than trusting the cached state.
 *
 * Worth the round-trip immediately before deciding to queue a punch: the cached
 * value can be seconds stale, and a stale "offline" would queue something that
 * could have gone straight through. Falls back to the cached value if the fetch
 * itself fails.
 */
export const fetchIsOnline = async () => isStateOnline(await refreshState());

/** `shouldAttemptRequest` against a freshly fetched state. */
export const fetchShouldAttemptRequest = async () =>
  shouldAttemptRequest(await refreshState());

/**
 * Registers a callback for offline → online transitions.
 *
 * Edge-triggered, not level-triggered: it fires on the transition, not on every
 * NetInfo event, so a wifi handover that emits three events in a row does not
 * start three drains.
 *
 * @returns {() => void} unsubscribe
 */
export const addReconnectListener = (listener) => {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
};

const notifyReconnect = (state) => {
  reconnectListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.log("[NetworkListener] Reconnect listener failed:", error?.message);
    }
  });
};

/**
 * Registers a callback for connectivity changes in BOTH directions.
 *
 * `addReconnectListener` fires only on offline → online, because that is all the
 * sync triggers need. The UI needs the other edge too — something has to be told
 * when to *show* the offline banner, not just when to hide it.
 *
 * Also edge-triggered: a wifi handover that emits several events without
 * changing the answer notifies nobody.
 *
 * @param {(online: boolean, state: object) => void} listener
 * @returns {() => void} unsubscribe
 */
export const addNetworkChangeListener = (listener) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

const notifyChange = (online, state) => {
  changeListeners.forEach((listener) => {
    try {
      listener(online, state);
    } catch (error) {
      console.log("[NetworkListener] Change listener failed:", error?.message);
    }
  });
};

/**
 * Starts watching. Idempotent — a second call while already started is a no-op
 * rather than a second subscription, so it is safe to call from a component
 * effect that re-runs.
 *
 * @returns {() => void} stop
 */
export const startNetworkListener = () => {
  if (unsubscribe) return stopNetworkListener;

  // Seed from a real fetch so the first `isOnline()` — which can be called
  // before any NetInfo event arrives — is not just the optimistic default.
  fetchIsOnline().catch(() => {});

  unsubscribe = NetInfo.addEventListener((state) => {
    const wasOnline = isStateOnline(currentState);

    currentState = {
      isConnected: !!state?.isConnected,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? "unknown",
    };

    const nowOnline = isStateOnline(currentState);

    if (wasOnline !== nowOnline) {
      console.log(
        nowOnline
          ? `[NetworkListener] Back online (${currentState.type})`
          : "[NetworkListener] Offline",
      );
      notifyChange(nowOnline, currentState);
    }

    if (!wasOnline && nowOnline) notifyReconnect(currentState);
  });

  return stopNetworkListener;
};

export const stopNetworkListener = () => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};

/** Test seam — resets the module's view of the world. */
export const resetNetworkListener = () => {
  stopNetworkListener();
  reconnectListeners.clear();
  changeListeners.clear();
  currentState = {
    isConnected: true,
    isInternetReachable: null,
    type: "unknown",
  };
};

export default {
  addNetworkChangeListener,
  addReconnectListener,
  fetchIsOnline,
  fetchShouldAttemptRequest,
  getNetworkState,
  isOnline,
  isStateOnline,
  resetNetworkListener,
  shouldAttemptRequest,
  startNetworkListener,
  stopNetworkListener,
};

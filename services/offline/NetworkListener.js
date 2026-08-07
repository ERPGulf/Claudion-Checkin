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
 * The distinction that matters is `isInternetReachable` vs `isConnected`.
 * A phone on captive-portal hotel wifi, or on a cell connection with no data
 * allowance, reports `isConnected: true` and reaches nothing. Treating that as
 * online means every punch takes a full request timeout before being queued —
 * the employee waits, twice, at the door. So reachability wins when it is known,
 * and only falls back to `isConnected` while it is still null (the state NetInfo
 * reports before its first probe completes).
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
 * Asks NetInfo directly rather than trusting the cached state.
 *
 * Worth the round-trip immediately before deciding to queue a punch: the cached
 * value can be seconds stale, and a stale "offline" would queue something that
 * could have gone straight through. Falls back to the cached value if the fetch
 * itself fails.
 */
export const fetchIsOnline = async () => {
  try {
    const state = await NetInfo.fetch();
    currentState = {
      isConnected: !!state?.isConnected,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? "unknown",
    };
    return isStateOnline(currentState);
  } catch {
    return isOnline();
  }
};

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
  getNetworkState,
  isOnline,
  isStateOnline,
  resetNetworkListener,
  startNetworkListener,
  stopNetworkListener,
};

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
 * One question: **is there a transport?** `isInternetReachable` is deliberately
 * NOT consulted, by anything.
 *
 * It used to be, on the reasoning that a phone on captive-portal wifi reports
 * `isConnected: true` and reaches nothing, so believing it makes a punch wait
 * out a request timeout before being queued. That reasoning was wrong about
 * which error is cheaper.
 *
 * `isInternetReachable` is a probe result, not a fact. On Android it is
 * `NET_CAPABILITY_VALIDATED` — the OS captive-portal check — and it stays
 * `false` for as long as the device is on a network that blocks Android's check
 * endpoint, which firewalled site wifi and some roaming data connections do
 * while carrying the app's traffic perfectly. Believing it cost real payroll
 * data twice over: the ordinary check-in API was skipped on working
 * connections, and the drain then declined to deliver what had been queued, so
 * rows sat in `pending` for days while the banner told the employee they were
 * offline.
 *
 * A wrong "there is a transport" costs one failed request and one backoff step.
 * A wrong "we are offline" costs a day's attendance and tells the employee a
 * comforting lie about it. So the probe earns no vote, and there is one answer
 * here rather than two that can disagree.
 *
 * `shouldAttemptRequest` is kept as a second name for it because that is what
 * the service layer reads and it names the intent — but it is the same
 * predicate, and there is no second behaviour to get out of step.
 */

let currentState = {
  isConnected: true,
  isInternetReachable: null,
  type: "unknown",
};

let unsubscribe = null;
const reconnectListeners = new Set();
const changeListeners = new Set();

/**
 * The one predicate: is there an interface that could carry a request?
 *
 * `isInternetReachable` is not read — see the note at the top of this file.
 * Aeroplane mode and a genuinely down interface report `type: "none"`, which is
 * the case this exists to catch: with no transport there is nothing to attempt,
 * and skipping it is what keeps a punch at the door instant.
 */
export const isStateOnline = (state) => {
  if (!state) return false;
  if (state.type === "none") return false;
  return state.isConnected !== false;
};

/**
 * The same predicate under the name the service layer reads. Kept because
 * "should I attempt this request?" is the question those call sites are asking,
 * and reading `isOnline` there invites someone to reintroduce a probe check.
 */
export const shouldAttemptRequest = (state = currentState) =>
  isStateOnline(state);

/** Last known connectivity. Synchronous — safe inside a hot path. */
export const isOnline = () => isStateOnline(currentState);

/**
 * The full last-known state, for logging and diagnostics.
 *
 * This is the only place `isInternetReachable` survives, and diagnostics is the
 * only thing it is good for: it is worth having in a log when someone reports a
 * punch behaving oddly, and worth nothing as an input to a decision.
 */
export const getNetworkState = () => ({ ...currentState });

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

/** `fetchIsOnline` under the name the service layer reads. Same predicate. */
export const fetchShouldAttemptRequest = fetchIsOnline;

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

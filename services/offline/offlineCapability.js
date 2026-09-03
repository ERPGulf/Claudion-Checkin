// src/services/offline/offlineCapability.js
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether THIS server can accept offline attendance at all.
 *
 * A per-row `blocked` state answers "did this punch land?". It cannot answer
 * "does this tenant have the feature?", and conflating the two produced a real
 * problem: on a server without `add_offline_employee_checkins` deployed, every
 * employee queues punches that can never sync and gets a permanent
 * "Waiting for your administrator" banner they can do nothing about. A warning
 * that is always on is not a warning, it is furniture — and the queue quietly
 * fills with records the server will never take.
 *
 * So the endpoint's absence is recorded once, as a property of the deployment
 * rather than of a punch, and it changes three things:
 *
 *  1. new offline punches are refused honestly instead of queued into a hole,
 *  2. the administrator banner goes quiet — there is nothing to act on, and it
 *     would otherwise never clear,
 *  3. existing queued rows are kept and still retried, so nothing is lost and
 *     the moment someone deploys the endpoint the queue drains itself.
 *
 * Tri-state on purpose. `null` means nobody has found out yet, and that is not
 * the same as "no" — an app that has never synced must behave optimistically,
 * or a first-launch outage would disable the feature on a server that supports
 * it perfectly well.
 */

export const CAPABILITY_KEY = "offlineSyncSupported";

/**
 * The administrator's switch (`attendance_action.offline_attendance`), mirrored
 * where the services can read it.
 *
 * It lives in Redux, which is fine for the UI but not for `submitAttendance` —
 * and the two answers have to agree, because they used to disagree in the worst
 * possible direction: the switch stopped the background sync manager while the
 * punch path went on queueing, so a disabled tenant's punches were written to a
 * queue that nothing drained. They sat in `pending` forever, showed "Pending
 * sync", and never reached the backend.
 *
 * The rule now, in both places: this switch decides whether a punch may be
 * *queued*. It never decides whether a punch already queued is *delivered*.
 *
 * Tri-state for the same reason as the capability above — `null` is "the server
 * has not said", and `utils/featureSettings.js` defaults an unknown feature to
 * available, so unknown must permit queueing rather than refuse it.
 */
let adminEnabled = null;

/** Mirrors the tenant's switch. `null`/`undefined` means "not yet known". */
export const setOfflineQueueingAllowed = (value) => {
  adminEnabled = value === null || value === undefined ? null : !!value;
};

/** True only when the administrator has positively switched offline off. */
export const isOfflineQueueingDisallowed = () => adminEnabled === false;

/** `true` supported · `false` endpoint missing · `null` not yet known. */
let cached = null;
let hydrated = false;

const listeners = new Set();

const emit = () => {
  listeners.forEach((listener) => {
    try {
      listener(cached);
    } catch (error) {
      console.log("[offlineCapability] Listener failed:", error?.message);
    }
  });
};

/** Subscribe to capability changes. Returns an unsubscribe function. */
export const addCapabilityListener = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Reads the stored value into memory. Safe to call repeatedly. */
export const hydrateOfflineCapability = async () => {
  if (hydrated) return cached;

  try {
    const stored = await AsyncStorage.getItem(CAPABILITY_KEY);
    if (stored === "true") cached = true;
    else if (stored === "false") cached = false;
    else cached = null;
  } catch {
    cached = null;
  }

  hydrated = true;
  return cached;
};

/** Synchronous snapshot. `null` until something has been learned. */
export const getOfflineCapability = () => cached;

/** True only when we positively know the server cannot take offline records. */
export const isOfflineSyncUnsupported = () => cached === false;

const write = async (value) => {
  if (cached === value) return;

  cached = value;
  hydrated = true;

  try {
    await AsyncStorage.setItem(CAPABILITY_KEY, String(value));
  } catch {
    // The in-memory value still governs this session.
  }

  console.log("[offlineCapability] Offline sync supported:", value);
  emit();
};

/**
 * Called when a sync fails because the endpoint is not on this server.
 *
 * Only ever from `ENDPOINT_MISSING` — an auth or configuration block says
 * nothing about whether the feature exists, and treating those as "unsupported"
 * would disable offline attendance over a momentary permission problem.
 */
export const markOfflineSyncUnsupported = () => write(false);

/**
 * Called whenever the server accepts a record — including a duplicate, which is
 * still proof the endpoint is there and answering.
 *
 * This is what makes the whole thing self-healing: nobody has to tell the app
 * that the endpoint was deployed. The next launch retries a blocked row, the
 * server takes it, and offline attendance turns itself back on.
 */
export const markOfflineSyncSupported = () => write(true);

/**
 * Forgets what we learned. Logout only — the next login may be a different
 * tenant, and a remembered "unsupported" would disable offline attendance on a
 * server that supports it.
 */
export const clearOfflineCapability = async () => {
  cached = null;
  hydrated = false;
  // The next login may be a different tenant with the opposite setting.
  adminEnabled = null;

  try {
    await AsyncStorage.removeItem(CAPABILITY_KEY);
  } catch {
    // The in-memory reset is the part that matters this session.
  }

  emit();
};

/** Test seam. */
export const resetOfflineCapability = () => {
  cached = null;
  hydrated = false;
  adminEnabled = null;
  listeners.clear();
};

export default {
  CAPABILITY_KEY,
  addCapabilityListener,
  clearOfflineCapability,
  getOfflineCapability,
  hydrateOfflineCapability,
  isOfflineQueueingDisallowed,
  isOfflineSyncUnsupported,
  markOfflineSyncSupported,
  markOfflineSyncUnsupported,
  resetOfflineCapability,
  setOfflineQueueingAllowed,
};

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Offline sync alerts" — whether the *administrator* banner is shown.
 *
 * Scope is narrow on purpose, and the narrowness is the safety property. This
 * can silence the "Waiting for your administrator" banner and nothing else. It
 * can never hide "needs correction", because that one is the employee's to act
 * on and hiding it would let someone quietly lose a day's pay.
 *
 * The banner it controls is unactionable by definition — the employee cannot
 * deploy an endpoint or grant a permission — so on a tenant where that state
 * persists it is a permanent notice nobody can clear. Most of that is handled
 * automatically by the capability probe in
 * services/offline/offlineCapability.js, which goes quiet on a server that has
 * no offline endpoint at all. This setting covers the rest: a tenant that
 * *does* support offline attendance but is misconfigured for a while, where the
 * notice is correct but the employee has already been told and does not need
 * telling again every time they open the app.
 *
 * Records are never affected. Turning this off changes what is displayed, never
 * what is stored, retried or synced — the queue keeps the punches and keeps
 * trying, and Attendance History still shows every one of them with its chip.
 *
 * Deliberately outside Redux, matching settings/appearance.js: it is a device
 * display preference, not account data, so it must survive `clearStore()` /
 * REVERT_ALL on logout.
 */

export const OFFLINE_SYNC_ALERTS_KEY = 'offline_sync_alerts_enabled';

/** Visible by default. A payroll warning has to be opt-*out*, never opt-in. */
export const OFFLINE_SYNC_ALERTS_DEFAULT = true;

let enabled = OFFLINE_SYNC_ALERTS_DEFAULT;
let hydrated = false;
const listeners = new Set();

function emit() {
  listeners.forEach(listener => listener());
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current value — a primitive, so it is a stable useSyncExternalStore snapshot. */
export function getSnapshot() {
  return enabled;
}

/** True once storage has been read at least once. */
export function getHydratedSnapshot() {
  return hydrated;
}

/**
 * Reads the stored preference into memory.
 *
 * Unlike the Home-experience flag this does NOT need to be awaited before the
 * navigator mounts — the banner is an overlay, and the worst case is it appears
 * for one frame before hydration turns it off. Blocking startup on it would be
 * a worse trade.
 */
export async function hydrate() {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_SYNC_ALERTS_KEY);
    if (stored !== null) enabled = stored === 'true';
  } catch {
    // Keep the default; a preference that cannot be read is not worth failing on.
  }

  hydrated = true;
  emit();
  return enabled;
}

export async function setEnabled(next) {
  const value = !!next;
  if (value === enabled) return;

  enabled = value;
  emit();

  try {
    await AsyncStorage.setItem(OFFLINE_SYNC_ALERTS_KEY, String(value));
  } catch {
    // In-memory value still governs this session.
  }
}

/** Test seam. */
export function reset() {
  enabled = OFFLINE_SYNC_ALERTS_DEFAULT;
  hydrated = false;
  listeners.clear();
}

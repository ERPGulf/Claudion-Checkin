import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Appearance preference: follow the OS, or pin light/dark.
 *
 * Same module-store shape as settings/homeExperience.js — a listener set read
 * through `useSyncExternalStore`, so there is no provider to mount and every
 * consumer re-renders the instant the mode changes.
 *
 * Deliberately outside Redux: this is a device display preference, not account
 * data, so it must survive `clearStore()` / REVERT_ALL on logout.
 */

export const APPEARANCE_KEY = 'settings_appearance_mode';

export const APPEARANCE_MODES = ['system', 'light', 'dark'];

/** Following the OS is the iOS-native default and what users expect. */
export const APPEARANCE_DEFAULT = 'system';

let mode = APPEARANCE_DEFAULT;
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

/**
 * Current mode. Returns a primitive, so it is a stable snapshot for
 * useSyncExternalStore without any caching.
 */
export function getSnapshot() {
  return mode;
}

/** True once storage has been read at least once. */
export function getHydratedSnapshot() {
  return hydrated;
}

/**
 * Read the stored preference into memory. Await this during app bootstrap: if
 * the tree renders first it paints the default theme and then repaints, which
 * reads as a flash of the wrong palette.
 */
export async function hydrate() {
  try {
    const stored = await AsyncStorage.getItem(APPEARANCE_KEY);
    // Only accept modes this module writes. A missing key reads back as `null`
    // *or* `undefined` depending on the platform, and an unrecognised value
    // should fall back to the default rather than wedging the theme.
    if (APPEARANCE_MODES.includes(stored)) {
      mode = stored;
    }
  } catch (error) {
    // Keep the default; a display preference is not worth blocking boot for.
  }
  hydrated = true;
  emit();
  return mode;
}

/**
 * Update the preference. Notifies subscribers synchronously so the theme
 * switches immediately, then persists in the background — a failed write costs
 * the choice on next launch, not this session.
 */
export async function setMode(next) {
  if (!APPEARANCE_MODES.includes(next) || next === mode) return;

  mode = next;
  emit();

  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, next);
  } catch (error) {
    // Intentionally silent, matching how the rest of the app treats storage.
  }
}

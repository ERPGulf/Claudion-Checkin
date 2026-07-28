import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * TEMPORARY EXPERIMENT — "New Home Experience" toggle.
 * =====================================================
 * Lets testers switch between the redesigned Home screen and the pre-redesign
 * one without restarting the app.
 *
 * ---- REMOVAL CHECKLIST -------------------------------------------------
 * 1. Delete this file, hooks/useHomeExperience.js and
 *    components/experimental/.
 * 2. Delete screens/HomeLegacy.jsx and components/HomeLegacy/.
 * 3. navigation/home.tabbar.jsx — drop the useHomeExperience() call and the
 *    `legacy*` branches; keep the modern screen options and Home.
 * 4. screens/Profile.jsx — drop the <HomeExperienceSetting /> line + import.
 * 5. App.js — drop the `await hydrateHomeExperience()` line + import.
 * 6. Optional: AsyncStorage.removeItem('experimental_new_home_experience')
 *    once, to clear the stored flag from devices.
 * -----------------------------------------------------------------------
 *
 * Deliberately outside Redux: the flag is a device display preference, not
 * account data, so it must survive `clearStore()` / REVERT_ALL on logout.
 * Keeping it out of the persisted root reducer also means removal leaves no
 * orphaned slice behind.
 */

export const HOME_EXPERIENCE_KEY = 'experimental_new_home_experience';

/**
 * Value used before storage has been read, and when nothing is stored yet.
 * `true` because the redesigned Home is what this build already ships — the
 * toggle is an opt-*out*. Flip to `false` to ship the old Home by default.
 */
export const HOME_EXPERIENCE_DEFAULT = true;

let enabled = HOME_EXPERIENCE_DEFAULT;
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
 * Current value. Returns a primitive, so it is a stable snapshot for
 * useSyncExternalStore without any caching.
 */
export function getSnapshot() {
  return enabled;
}

/** True once storage has been read at least once. */
export function getHydratedSnapshot() {
  return hydrated;
}

/**
 * Read the stored preference into memory.
 *
 * Await this during app bootstrap, before the navigator mounts. If the
 * navigator renders first, it picks the default Home, then swaps to the stored
 * one — which remounts the screen and fires its focus effects (and their
 * network calls) twice.
 */
export async function hydrate() {
  try {
    const stored = await AsyncStorage.getItem(HOME_EXPERIENCE_KEY);
    // Only accept values this module wrote. A missing key reads back as `null`
    // *or* `undefined` depending on the platform/mock, and a corrupted value
    // should fall back to the default rather than silently opting the user out.
    if (stored === 'true' || stored === 'false') {
      enabled = stored === 'true';
    }
  } catch (error) {
    // Keep the default; a display preference is not worth blocking boot for.
  }
  hydrated = true;
  emit();
  return enabled;
}

/**
 * Update the preference. Notifies subscribers synchronously so the UI switches
 * immediately, then persists in the background — a failed write costs the
 * user's choice on next launch, not this session.
 */
export async function setEnabled(next) {
  const value = Boolean(next);
  if (value === enabled) return;

  enabled = value;
  emit();

  try {
    await AsyncStorage.setItem(HOME_EXPERIENCE_KEY, String(value));
  } catch (error) {
    // Intentionally silent, matching how the rest of the app treats storage.
  }
}

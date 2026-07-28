import { useSyncExternalStore } from 'react';
import {
  getHydratedSnapshot,
  getSnapshot,
  setEnabled,
  subscribe,
} from '../settings/homeExperience';

/**
 * TEMPORARY — reads the "New Home Experience" flag.
 *
 * `useSyncExternalStore` rather than Context: no provider to add to App.js, no
 * Redux slice to persist and later remove, and every consumer re-renders the
 * moment the value changes — which is what makes the toggle take effect without
 * a restart.
 *
 * @returns {{ enabled: boolean, hydrated: boolean, setEnabled: (v: boolean) => Promise<void> }}
 */
export default function useHomeExperience() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot);
  const hydrated = useSyncExternalStore(subscribe, getHydratedSnapshot);

  // `setEnabled` is a module-level function, so it is already referentially
  // stable — safe to use in deps arrays and to pass straight to a Switch.
  return { enabled, hydrated, setEnabled };
}

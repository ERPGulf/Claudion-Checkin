import { useSyncExternalStore } from 'react';
import {
  getHydratedSnapshot,
  getSnapshot,
  setEnabled,
  subscribe,
} from '../settings/offlineSyncAlerts';

/**
 * Reads the "Offline sync alerts" preference.
 *
 * `useSyncExternalStore` rather than Context, matching `useHomeExperience`: no
 * provider to add, no Redux slice to persist, and the banner reacts the moment
 * the switch moves rather than on the next mount.
 *
 * @returns {{ enabled: boolean, hydrated: boolean, setEnabled: (v: boolean) => Promise<void> }}
 */
export default function useOfflineSyncAlerts() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot);
  const hydrated = useSyncExternalStore(subscribe, getHydratedSnapshot);

  return { enabled, hydrated, setEnabled };
}

import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';
import { COLORS, DARK_COLORS } from '../constants';
import {
  getSnapshot as getAppearanceMode,
  setMode,
  subscribe,
} from '../settings/appearance';
// TEMPORARY: New Home Experience experiment — see the note on `newHomeEnabled`.
import useHomeExperience from './useHomeExperience';

/**
 * Resolves the active color palette.
 *
 * Precedence: the stored appearance mode wins; `'system'` defers to the OS.
 * Both paths are live — changing either re-renders every consumer with no
 * restart.
 *
 * Consumers must read colors through this hook rather than importing `COLORS`,
 * otherwise they stay pinned to the light palette.
 *
 * @returns {{
 *   isDark: boolean,
 *   colors: typeof COLORS,
 *   scheme: 'light' | 'dark',
 *   mode: 'system' | 'light' | 'dark',
 *   setMode: (mode: string) => Promise<void>,
 *   darkAvailable: boolean,
 * }}
 */
export default function useAppTheme() {
  const systemScheme = useColorScheme();
  const mode = useSyncExternalStore(subscribe, getAppearanceMode);

  // TEMPORARY (New Home Experience experiment): the legacy Home screen has no
  // dark palette, so dark mode is gated on the new UI being active. Turning the
  // toggle off forces light and disables the appearance control.
  // On removal: delete this line, the `newHomeEnabled &&` below, and expose
  // `darkAvailable` as a constant `true` (or drop it and its call sites).
  const { enabled: newHomeEnabled } = useHomeExperience();

  const prefersDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const isDark = newHomeEnabled && prefersDark;

  return {
    isDark,
    colors: isDark ? DARK_COLORS : COLORS,
    scheme: isDark ? 'dark' : 'light',
    mode,
    setMode,
    darkAvailable: newHomeEnabled,
  };
}

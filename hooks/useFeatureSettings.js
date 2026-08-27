import { useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  selectFeatureSettings,
  selectFeatureSettingsError,
  selectFeatureSettingsStatus,
  selectFeatureSettingsFetchedAt,
  settingsRequested,
  settingsReceived,
  settingsFailed,
} from '../redux/Slices/FeatureSettingsSlice';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import {
  buildSettingsScope,
  getFeatureValue,
  isFeatureEnabled,
  isRouteEnabled,
} from '../utils/featureSettings';

/**
 * How the app asks "is this feature on?".
 *
 * Every caller goes through one of the three hooks below, so no component ever
 * touches the raw response or the slice's shape, and there is exactly one
 * definition of what an absent value means (utils/featureSettings.js).
 *
 * None of these fetch. The settings are fetched centrally by
 * <FeatureSettingsBootstrap>; these only read what is already in the store, so
 * they are free to call from as many components as needed and cost nothing on
 * render.
 */

/**
 * `useFeatureEnabled('loan_application')`
 * `useFeatureEnabled('attendance_action.attendance_history')`
 *
 * Returns a boolean. Unknown paths and unfetched settings return the documented
 * default rather than throwing or hiding the feature.
 */
export function useFeatureEnabled(path) {
  return useSelector(state => isFeatureEnabled(selectFeatureSettings(state), path));
}

/**
 * The same question for several features at once, as a `{ path: boolean }` map.
 *
 * For lists — the Home menu, the Quick Access picker — where asking once per row
 * would mean one `useSelector` per row and a hook count that changes with the
 * data.
 *
 * `paths` is joined into the memo key rather than used by identity, so callers
 * can pass an inline array without re-subscribing on every render.
 */
export function useFeaturesEnabled(paths) {
  const settings = useSelector(selectFeatureSettings);
  const key = paths.join('|');

  return useMemo(() => {
    const map = {};
    for (const path of key.split('|')) {
      if (path) map[path] = isFeatureEnabled(settings, path);
    }
    return map;
    // `key` is the value identity of `paths`; `settings` is the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, key]);
}

/** Whether a route may be entered — used by the navigation guard. */
export function useRouteEnabled(routeName) {
  return useSelector(state =>
    isRouteEnabled(selectFeatureSettings(state), routeName),
  );
}

/**
 * A non-boolean setting: `attendance_action.geo_tagging`,
 * `attendance_action.geo_tagging_level`,
 * `attendance_action.offline_attendance_version`.
 *
 * Separate from `useFeatureEnabled` on purpose — these are not flags, and
 * reading a version string through a boolean helper is how a `"0"` version ends
 * up disabling something.
 */
export function useFeatureValue(path) {
  return useSelector(state => getFeatureValue(selectFeatureSettings(state), path));
}

/**
 * The whole picture, plus a retry. For the bootstrap and for any settings UI
 * that wants to show load state; ordinary feature checks should use the
 * narrower hooks above.
 */
export default function useFeatureSettings() {
  const dispatch = useDispatch();
  const settings = useSelector(selectFeatureSettings);
  const status = useSelector(selectFeatureSettingsStatus);
  const error = useSelector(selectFeatureSettingsError);
  const lastFetchedAt = useSelector(selectFeatureSettingsFetchedAt);
  const employeeCode = useSelector(selectEmployeeCode);

  /**
   * Fetches and stores. Never throws — a failure is recorded on the slice,
   * which keeps the previous settings, so callers can fire this speculatively.
   */
  const refresh = useCallback(async () => {
    const baseUrl = await AsyncStorage.getItem('baseUrl');
    const scope = buildSettingsScope(baseUrl, employeeCode);

    // No provisioned backend means nothing to ask and nobody to ask it of.
    if (!scope) return { ok: false, error: 'No backend configured.' };

    dispatch(settingsRequested({ scope }));

    const res = await getFeatureSettings();

    if (res?.error) {
      dispatch(settingsFailed({ error: res.error }));
      return { ok: false, error: res.error };
    }

    dispatch(settingsReceived({ settings: res.message, scope }));
    return { ok: true };
  }, [dispatch, employeeCode]);

  return {
    settings,
    status,
    error,
    lastFetchedAt,
    isLoading: status === 'loading',
    isError: status === 'error',
    refresh,
    isEnabled: useCallback(path => isFeatureEnabled(settings, path), [settings]),
    valueOf: useCallback(path => getFeatureValue(settings, path), [settings]),
  };
}

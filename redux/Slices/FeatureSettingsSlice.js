import { createSlice } from '@reduxjs/toolkit';
import {
  emptyFeatureSettings,
  isFeatureEnabled,
  isRouteEnabled,
  getFeatureValue,
} from '../../utils/featureSettings';

/**
 * Which features the server has enabled, for the length of a session.
 *
 * Lives in the existing store rather than in a new context or query cache,
 * which buys three things the app already relies on:
 *
 *  - **Caching for free.** redux-persist writes the whole root reducer to
 *    AsyncStorage (see redux/Store.js), so the last known answer survives a
 *    relaunch and the app renders the correct menu on its first frame instead of
 *    flashing every feature and then removing some.
 *  - **Logout teardown for free.** `REVERT_ALL` — dispatched by `clearStore()`
 *    on manual logout and on terminal session failure — resets this slice with
 *    every other one, so Employee A's settings cannot survive into Employee B's
 *    session.
 *  - **One subscription model.** Screens already `useSelector`; feature checks
 *    do not need a second one.
 *
 * `scope` is the belt to that braces. It records the (backend, employee) the
 * settings were fetched for, and `selectFeatureSettings` refuses to hand back
 * settings whose scope no longer matches the live one. That covers the case
 * REVERT_ALL does not: re-provisioning the device to a different tenant by QR
 * scan without an intervening logout, where the persisted blob would otherwise
 * still be sitting there and would be applied to the new backend.
 */

const initialState = {
  /** Normalised settings, or null when nothing has ever been fetched. */
  settings: null,
  /** The (backend, employee) `settings` belong to. */
  scope: null,
  /** 'idle' | 'loading' | 'success' | 'error' */
  status: 'idle',
  /** Message from the last failed fetch, for the retry affordance. */
  error: null,
  /** When the last *successful* fetch landed; drives the refresh interval. */
  lastFetchedAt: null,
  /** Scope of an in-flight request, so a late response can be identified. */
  pendingScope: null,
};

const FeatureSettingsSlice = createSlice({
  name: 'featureSettings',
  initialState,
  extraReducers: builder => builder.addCase('REVERT_ALL', () => initialState),
  reducers: {
    settingsRequested: (state, action) => {
      state.status = 'loading';
      // The scope being fetched for. Recorded now so a response that arrives
      // after the user has switched tenants can be told apart from a current one.
      if (action.payload?.scope) state.pendingScope = action.payload.scope;
    },

    settingsReceived: (state, action) => {
      const { settings, scope, now } = action.payload;

      state.settings = settings;
      state.scope = scope ?? null;
      state.status = 'success';
      state.error = null;
      state.lastFetchedAt = now ?? Date.now();
      state.pendingScope = null;
    },

    settingsFailed: (state, action) => {
      state.status = 'error';
      state.error = action.payload?.error || 'Unable to load feature settings.';
      state.pendingScope = null;
      // `settings`, `scope` and `lastFetchedAt` are deliberately untouched: a
      // failed refresh must keep the last known answer, so a feature the admin
      // explicitly disabled stays disabled through an outage rather than
      // reappearing on the optimistic default.
    },

    /** Re-provisioned to a different backend, or a different employee. */
    settingsInvalidated: () => initialState,
  },
});

export const {
  settingsRequested,
  settingsReceived,
  settingsFailed,
  settingsInvalidated,
} = FeatureSettingsSlice.actions;

/* -------------------------------------------------------------------------
 * Selectors
 *
 * These are the only sanctioned way to read feature settings. Nothing outside
 * this file and utils/featureSettings.js should touch `state.featureSettings`.
 * ---------------------------------------------------------------------- */

const selectSlice = state => state.featureSettings || initialState;

export const selectFeatureSettingsStatus = state => selectSlice(state).status;
export const selectFeatureSettingsError = state => selectSlice(state).error;
export const selectFeatureSettingsFetchedAt = state =>
  selectSlice(state).lastFetchedAt;
export const selectFeatureSettingsScope = state => selectSlice(state).scope;

/**
 * The settings to apply right now.
 *
 * Returns null — which every helper reads as "unknown", and therefore as the
 * documented optimistic default — when nothing has been fetched. It does NOT
 * return null merely because the last refresh failed; see `settingsFailed`.
 */
export const selectFeatureSettings = state => selectSlice(state).settings;

/**
 * Settings, but only if they belong to `scope`. Anything else is treated as
 * absent, so one tenant's or employee's answers can never be applied to
 * another's.
 */
export const selectScopedFeatureSettings = (state, scope) => {
  const slice = selectSlice(state);
  if (!slice.settings) return null;
  if (!scope || !slice.scope) return null;

  return slice.scope === scope ? slice.settings : null;
};

/** `isFeatureEnabled` bound to the store. */
export const makeSelectFeatureEnabled = path => state =>
  isFeatureEnabled(selectFeatureSettings(state), path);

/** A non-boolean setting (`geo_tagging`, `offline_attendance_version`). */
export const makeSelectFeatureValue = path => state =>
  getFeatureValue(selectFeatureSettings(state), path);

/** Whether a named route may be entered. */
export const selectRouteEnabled = (state, routeName) =>
  isRouteEnabled(selectFeatureSettings(state), routeName);

export { emptyFeatureSettings };

export default FeatureSettingsSlice.reducer;

const { createSlice } = require("@reduxjs/toolkit");
import { ATTENDANCE_FEATURES, buildSettingsScope, isFeatureEnabled } from "../../utils/featureSettings";
import { selectFeatureSettings } from "./FeatureSettingsSlice";

/**
 * Automatic attendance is configured by the employer alone — there is no
 * employee switch. Both levels must enable it (`selectAutoAttendanceConfigured`):
 *
 *  - the tenant — `employee_checkin_setting` must send
 *    `attendance_action.geo_tagging: true`. False, null, missing or anything
 *    else is off (utils/featureSettings).
 *  - the employee — `geotagging` on their HR record (returned by
 *    `employee_app.attendance_api.get_employee_data`). Values mirror the
 *    ERPNext select field:
 *      0 DISABLED       — the feature is not available for this employee.
 *      1 WARNINGS_ONLY  — never monitored and never checked in/out; no
 *                         warning behaviour is defined for it yet.
 *      2 ALL_ACTIONS    — monitor AND automatically check in/out at the boundary.
 *
 * Configured is not working: monitoring also needs location permission, which
 * only the employee can grant, and a native registration that succeeded
 * (`monitoring`, published by the bootstrap). Both answers persist with the
 * root reducer, so a relaunch restores the last answer received for the account.
 */
export const GEOTAGGING = {
  DISABLED: 0,
  WARNINGS_ONLY: 1,
  ALL_ACTIONS: 2,
};

// Read-only copy shown on the AutoAttendance screen so the user can see what
// their administrator has configured.
export const GEOTAGGING_LABELS = {
  [GEOTAGGING.DISABLED]: {
    title: "Disabled",
    description: "Automatic attendance is turned off for your account.",
  },
  [GEOTAGGING.WARNINGS_ONLY]: {
    title: "Warnings only",
    description:
      "Your location is not monitored, and you are not checked in or out automatically.",
  },
  [GEOTAGGING.ALL_ACTIONS]: {
    title: "All attendance actions",
    description:
      "Automatically checks you in and out when you cross the office boundary.",
  },
};

const VALID_VALUES = [
  GEOTAGGING.DISABLED,
  GEOTAGGING.WARNINGS_ONLY,
  GEOTAGGING.ALL_ACTIONS,
];

// Anything the server didn't send (or sent malformed) falls back to DISABLED —
// the feature stays off unless the backend explicitly enables it.
export const normalizeGeotagging = (value) => {
  const parsed = Number(value);
  return VALID_VALUES.includes(parsed) ? parsed : GEOTAGGING.DISABLED;
};

const initialState = {
  geotagging: GEOTAGGING.DISABLED,
  // The existing slice owns received employee policy as well as its UI value.
  // A bare legacy geotagging value cannot authorize a different employee/site.
  employeePolicy: null,
  // The same ordered employee response also owns mandatory manual-location
  // facts. Keep them separate so a location-only response cannot erase a mode.
  employeeLocationPolicy: null,
  policySequence: 0,
  policyRequest: null,
  // Native monitoring as the bootstrap last left it, for one account:
  // { scope, state: 'active' | 'unavailable' | 'permission' }.
  monitoring: null,
  // Per account (settings scope, tenant::employee): the location permission
  // state the employee last declined in, so onboarding does not ask again until
  // that state changes. Survives sign-out (see REVERT_ALL); keyed, so it never
  // reaches another account.
  declinedLocationAccess: {},
  // Bumped to ask AutoAttendanceBootstrap — the single owner of geofence
  // registration — to re-run its startup sequence. Location access granted
  // in-app arrives after the bootstrap's own attempt, which bailed at the
  // permission check and would not otherwise try again until the next
  // foreground.
  syncRequestId: 0,
};

export const AutoAttendanceSlice = createSlice({
  name: "autoAttendance",
  initialState,
  extraReducers: (builder) => builder.addCase("REVERT_ALL", (state) => ({
    ...initialState,
    declinedLocationAccess: state.declinedLocationAccess ?? {},
  })),
  reducers: {
    employeePolicyRequested: (state, action) => {
      state.policySequence = Math.max(state.policySequence || 0, action.payload.revision);
      state.policyRequest = action.payload;
    },
    employeePolicyReceived: (state, action) => {
      const policy = action.payload;
      if (state.policyRequest?.revision !== policy.revision ||
          state.policyRequest?.scope !== policy.scope ||
          state.policyRequest?.generation !== policy.generation) return;
      if (policy.locationPolicy && Object.keys(policy.locationPolicy).length) {
        const previous = state.employeeLocationPolicy;
        const matching = previous?.scope === policy.scope && previous?.accountId === policy.accountId;
        state.employeeLocationPolicy = {
          ...(matching ? previous : {}),
          ...policy.locationPolicy,
          scope: policy.scope,
          accountId: policy.accountId,
          generation: policy.generation,
          revision: policy.revision,
        };
      }
      if (policy.mode === null) return; // A partial response cannot erase a mode.
      const { locationPolicy, ...automaticPolicy } = policy;
      state.employeePolicy = automaticPolicy;
      state.geotagging = policy.mode;
    },
    employeePolicyRestored: (state, action) => {
      const policy = action.payload;
      if (state.employeePolicy?.scope === policy.scope &&
          state.employeePolicy?.accountId === policy.accountId) return;
      state.employeePolicy = policy;
      state.geotagging = policy.mode;
    },
    setAutoAttendanceGeotagging: (state, action) => {
      state.geotagging = normalizeGeotagging(action.payload);
    },
    autoAttendanceMonitoringChanged: (state, action) => {
      state.monitoring = action.payload;
    },
    locationAccessDeclined: (state, action) => {
      const { scope, key } = action.payload;
      if (!state.declinedLocationAccess) state.declinedLocationAccess = {};
      state.declinedLocationAccess[scope] = key;
    },
    // Coerced rather than incremented directly: persisted state written before
    // this field existed rehydrates without it, and undefined + 1 is NaN.
    requestAutoAttendanceSync: (state) => {
      state.syncRequestId = (Number(state.syncRequestId) || 0) + 1;
    },
  },
});

export const {
  employeePolicyRequested,
  employeePolicyReceived,
  employeePolicyRestored,
  setAutoAttendanceGeotagging,
  autoAttendanceMonitoringChanged,
  locationAccessDeclined,
  requestAutoAttendanceSync,
} = AutoAttendanceSlice.actions;

/** The signed-in account's settings scope, or null before its employee code. */
export const selectAutoAttendanceScope = (state) =>
  state.user?.userDetails?.employeeCode
    ? buildSettingsScope(state.user.baseUrl, state.user.userDetails.employeeCode)
    : null;

// The tenant's `geo_tagging: true`, for this account's settings.
export const selectAutoAttendanceTenantEnabled = (state) =>
  isFeatureEnabled(selectFeatureSettings(state), ATTENDANCE_FEATURES.AUTO_ATTENDANCE);

export const selectAutoAttendanceDeclinedLocationAccess = (state) =>
  state.autoAttendance?.declinedLocationAccess?.[selectAutoAttendanceScope(state)] ?? null;

export const selectAutoAttendanceGeotagging = (state) => {
  const policy = state.autoAttendance?.employeePolicy;
  if (state.user) {
    const scope = buildSettingsScope(state.user.baseUrl, state.user.userDetails?.employeeCode);
    return scope && policy?.scope === scope ? normalizeGeotagging(policy.mode) : GEOTAGGING.DISABLED;
  }
  return normalizeGeotagging(policy?.mode ?? state.autoAttendance?.geotagging);
};

// The employee's geotagging is not disabled (1 or 2).
export const selectAutoAttendanceAllowed = (state) =>
  selectAutoAttendanceGeotagging(state) !== GEOTAGGING.DISABLED;

export const selectAutoAttendanceSyncRequestId = (state) =>
  Number(state.autoAttendance?.syncRequestId) || 0;

// The employer's effective configuration: tenant `geo_tagging: true` AND
// employee geotagging 2. Warnings-only (1) is never monitored.
export const selectAutoAttendanceConfigured = (state) =>
  selectAutoAttendanceTenantEnabled(state) && selectAutoAttendanceFullActions(state);

// The account's monitoring state, or null before the bootstrap has reported one.
export const selectAutoAttendanceMonitoring = (state) => {
  const monitoring = state.autoAttendance?.monitoring;
  return monitoring && monitoring.scope === selectAutoAttendanceScope(state) ? monitoring.state : null;
};

// Configured, and the native registration is established.
export const selectAutoAttendanceOperational = (state) =>
  selectAutoAttendanceConfigured(state) && selectAutoAttendanceMonitoring(state) === "active";

export const selectAutoAttendanceFullActions = (state) =>
  selectAutoAttendanceGeotagging(state) === GEOTAGGING.ALL_ACTIONS;

export default AutoAttendanceSlice.reducer;

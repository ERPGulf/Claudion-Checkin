const { createSlice } = require("@reduxjs/toolkit");
import { buildSettingsScope } from "../../utils/featureSettings";

/**
 * Automatic attendance has two independent inputs:
 *
 *  - `geotagging` — the server-side policy on the employee's HR record (returned
 *    by `employee_app.attendance_api.get_employee_data`). It is the *ceiling*:
 *    what the administrator ALLOWS. Values mirror the ERPNext select field:
 *      0 DISABLED       — the feature is not available for this employee.
 *      1 WARNINGS_ONLY  — monitor office entry/exit + surface reliability
 *                         warnings, but do NOT check in/out.
 *      2 ALL_ACTIONS    — monitor AND automatically check in/out at the boundary.
 *
 *  - `userEnabled` — the user's own opt-in. Because monitoring uses background
 *    location and battery, the user must turn the service on themselves. This
 *    is persisted (the whole root reducer is persisted to AsyncStorage), so it
 *    stays on across app relaunches.
 *
 * Monitoring only runs when BOTH hold: the admin allows it (geotagging !== 0)
 * AND the user has opted in — see `selectAutoAttendanceActive`.
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
      "Detects when you enter or leave the office and shows reliability warnings, but does not check you in or out automatically.",
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
  userEnabled: false,
  // Bumped to ask AutoAttendanceBootstrap — the single owner of geofence
  // registration — to re-run its startup sequence. The AutoAttendance screen
  // uses it after granting location permission: the bootstrap's own attempt ran
  // the moment the opt-in flipped, which is before the OS prompt was answered,
  // so it bailed at the permission check and would not otherwise try again
  // until the next launch.
  syncRequestId: 0,
};

export const AutoAttendanceSlice = createSlice({
  name: "autoAttendance",
  initialState,
  extraReducers: (builder) => builder.addCase("REVERT_ALL", () => initialState),
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
    setAutoAttendanceUserEnabled: (state, action) => {
      state.userEnabled = Boolean(action.payload);
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
  setAutoAttendanceUserEnabled,
  requestAutoAttendanceSync,
} = AutoAttendanceSlice.actions;

export const selectAutoAttendanceGeotagging = (state) => {
  const policy = state.autoAttendance?.employeePolicy;
  if (state.user) {
    const scope = buildSettingsScope(state.user.baseUrl, state.user.userDetails?.employeeCode);
    return scope && policy?.scope === scope ? normalizeGeotagging(policy.mode) : GEOTAGGING.DISABLED;
  }
  return normalizeGeotagging(policy?.mode ?? state.autoAttendance?.geotagging);
};

// The administrator allows automatic attendance (policy is 1 or 2).
export const selectAutoAttendanceAllowed = (state) =>
  selectAutoAttendanceGeotagging(state) !== GEOTAGGING.DISABLED;

// The user's persisted opt-in.
export const selectAutoAttendanceUserEnabled = (state) =>
  Boolean(state.autoAttendance?.userEnabled);

export const selectAutoAttendanceSyncRequestId = (state) =>
  Number(state.autoAttendance?.syncRequestId) || 0;

// Effective on-state: monitoring should run only when both are true.
export const selectAutoAttendanceActive = (state) =>
  selectAutoAttendanceAllowed(state) && selectAutoAttendanceUserEnabled(state);

export const selectAutoAttendanceFullActions = (state) =>
  selectAutoAttendanceGeotagging(state) === GEOTAGGING.ALL_ACTIONS;

export const selectAutoAttendanceShowWarnings = (state) =>
  selectAutoAttendanceGeotagging(state) >= GEOTAGGING.WARNINGS_ONLY;

export default AutoAttendanceSlice.reducer;

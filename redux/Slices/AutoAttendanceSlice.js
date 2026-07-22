const { createSlice } = require("@reduxjs/toolkit");

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
  userEnabled: false,
};

export const AutoAttendanceSlice = createSlice({
  name: "autoAttendance",
  initialState,
  extraReducers: (builder) => builder.addCase("REVERT_ALL", () => initialState),
  reducers: {
    setAutoAttendanceGeotagging: (state, action) => {
      state.geotagging = normalizeGeotagging(action.payload);
    },
    setAutoAttendanceUserEnabled: (state, action) => {
      state.userEnabled = Boolean(action.payload);
    },
  },
});

export const { setAutoAttendanceGeotagging, setAutoAttendanceUserEnabled } =
  AutoAttendanceSlice.actions;

export const selectAutoAttendanceGeotagging = (state) =>
  normalizeGeotagging(state.autoAttendance?.geotagging);

// The administrator allows automatic attendance (policy is 1 or 2).
export const selectAutoAttendanceAllowed = (state) =>
  selectAutoAttendanceGeotagging(state) !== GEOTAGGING.DISABLED;

// The user's persisted opt-in.
export const selectAutoAttendanceUserEnabled = (state) =>
  Boolean(state.autoAttendance?.userEnabled);

// Effective on-state: monitoring should run only when both are true.
export const selectAutoAttendanceActive = (state) =>
  selectAutoAttendanceAllowed(state) && selectAutoAttendanceUserEnabled(state);

export const selectAutoAttendanceFullActions = (state) =>
  selectAutoAttendanceGeotagging(state) === GEOTAGGING.ALL_ACTIONS;

export const selectAutoAttendanceShowWarnings = (state) =>
  selectAutoAttendanceGeotagging(state) >= GEOTAGGING.WARNINGS_ONLY;

export default AutoAttendanceSlice.reducer;

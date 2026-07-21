const { createSlice } = require("@reduxjs/toolkit");

/**
 * "Full actions" modes call the real check-in/checkout API on ENTER/EXIT
 * (AutoAttendanceBootstrap); the monitor-only mode just tracks transitions
 * without acting on them. "Warnings" controls whether the AutoAttendance
 * screen shows the reliability banner (Precise Location / Low Power Mode /
 * battery optimization) — it does not change monitoring behavior itself.
 */
export const AUTO_ATTENDANCE_MODES = {
  DISABLED: "disabled",
  MONITOR_WITH_WARNINGS: "monitor_with_warnings",
  FULL_ACTIONS_NO_WARNINGS: "full_actions_no_warnings",
  FULL_ACTIONS_WITH_WARNINGS: "full_actions_with_warnings",
};

const FULL_ACTIONS_MODES = [
  AUTO_ATTENDANCE_MODES.FULL_ACTIONS_NO_WARNINGS,
  AUTO_ATTENDANCE_MODES.FULL_ACTIONS_WITH_WARNINGS,
];

const WARNINGS_MODES = [
  AUTO_ATTENDANCE_MODES.MONITOR_WITH_WARNINGS,
  AUTO_ATTENDANCE_MODES.FULL_ACTIONS_WITH_WARNINGS,
];

const initialState = {
  mode: AUTO_ATTENDANCE_MODES.DISABLED,
};

export const AutoAttendanceSlice = createSlice({
  name: "autoAttendance",
  initialState,
  extraReducers: (builder) => builder.addCase("REVERT_ALL", () => initialState),
  reducers: {
    setAutoAttendanceMode: (state, action) => {
      state.mode = action.payload;
    },
  },
});

export const { setAutoAttendanceMode } = AutoAttendanceSlice.actions;

export const selectAutoAttendanceMode = (state) => state.autoAttendance.mode;

export const selectAutoAttendanceEnabled = (state) =>
  state.autoAttendance.mode !== AUTO_ATTENDANCE_MODES.DISABLED;

export const selectAutoAttendanceFullActions = (state) =>
  FULL_ACTIONS_MODES.includes(state.autoAttendance.mode);

export const selectAutoAttendanceShowWarnings = (state) =>
  WARNINGS_MODES.includes(state.autoAttendance.mode);

export default AutoAttendanceSlice.reducer;

const { createSlice } = require("@reduxjs/toolkit");

const initialState = {
  checkin: false,
  checkinTime: null,
  checkoutTime: null,
  location: null, // selected location
  locations: [], // list of location objects
  todayHours: 0,
  monthlyHours: 0,
  breakMinutes: 0,
  breakTakenToday: false,
  onBreak: false,
  breakStartTime: null,

};

export const AttendanceSlice = createSlice({
  name: "attendance",
  initialState,
  extraReducers: (builder) => builder.addCase("REVERT_ALL", () => initialState),
  reducers: {
    setCheckin: (state, action) => {
      state.checkin = true;
      state.checkinTime = action.payload.checkinTime;
      state.location = action.payload?.location || null;
    },
    setCheckout: (state, action) => {
      state.checkin = false;
      state.checkoutTime = action.payload.checkoutTime;
      state.location = null; // clear location on checkout
    },
    setOnlyCheckIn: (state, action) => {
      state.checkin = action.payload;
    },
    resetCheckin: (state) => {
      state.checkin = false;
      state.checkinTime = null;
      state.checkoutTime = null;
      state.location = null;

      state.onBreak = false;
      state.breakStartTime = null;
      state.breakTakenToday = false;
      state.breakMinutes = 0;
    },
    setTodayHours: (state, action) => {
      state.todayHours = action.payload;
    },
    setMonthlyHours: (state, action) => {
      state.monthlyHours = action.payload;
    },
    setLocations: (state, action) => {
      state.locations = action.payload;
    },
    setSelectedLocation: (state, action) => {
      state.location = action.payload;
    },
    setBreakMinutes: (state, action) => {
      state.breakMinutes = action.payload;
    },
    setBreakStatus: (state, action) => {
      state.onBreak = action.payload.onBreak;
      state.breakStartTime = action.payload.breakStartTime;
    },

    setBreakTakenToday: (state, action) => {
      state.breakTakenToday = action.payload;
    },
  },
});

export const {
  setCheckin,
  setCheckout,
  setOnlyCheckIn,
  resetCheckin,
  setTodayHours,
  setMonthlyHours,
  setLocations,
  setSelectedLocation,
  setBreakMinutes,
  setBreakStatus,
  setBreakTakenToday,
} = AttendanceSlice.actions;

// selectors
export const selectCheckin = (state) => state.attendance.checkin;
export const selectCheckinTime = (state) => state.attendance.checkinTime;
export const selectCheckoutTime = (state) => state.attendance.checkoutTime;
export const selectLocation = (state) => state.attendance.location;
export const selectLocations = (state) => state.attendance.locations;
export const selectTodayHours = (state) => state.attendance.todayHours;
export const selectMonthlyHours = (state) => state.attendance.monthlyHours;
export const selectBreakMinutes = (state) => state.attendance.breakMinutes;
export const selectBreakTakenToday = (state) =>
  state.attendance.breakTakenToday;
export const selectOnBreak = (state) => state.attendance.onBreak;
export const selectBreakStartTime = (state) => state.attendance.breakStartTime;

export default AttendanceSlice.reducer;

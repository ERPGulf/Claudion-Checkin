const { createSlice } = require("@reduxjs/toolkit");

const initialState = {
  checkin: false,
  checkinTime: null,
  checkoutTime: null,
  location: null, // selected location
  locations: [], // list of location objects
  todayHours: 0,
  monthlyHours: 0,
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
  },
});

export const {
  setCheckin,
  setCheckout,
  setOnlyCheckIn,
  setTodayHours,
  setMonthlyHours,
  setLocations,
  setSelectedLocation,
} = AttendanceSlice.actions;

// selectors
export const selectCheckin = (state) => state.attendance.checkin;
export const selectCheckinTime = (state) => state.attendance.checkinTime;
export const selectCheckoutTime = (state) => state.attendance.checkoutTime;
export const selectLocation = (state) => state.attendance.location;
export const selectLocations = (state) => state.attendance.locations;
export const selectTodayHours = (state) => state.attendance.todayHours;
export const selectMonthlyHours = (state) => state.attendance.monthlyHours;

export default AttendanceSlice.reducer;

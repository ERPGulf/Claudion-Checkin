
const { createSlice } = require("@reduxjs/toolkit");

const initialState = {
  username: null,
  fullname: null,
  userDetails: null, 
  baseUrl: null,
  fileId: null,
  isWfh: false,
  employees: [],
};

export const UserSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setUsername: (state, action) => {
      state.username = action.payload;
    },
    setFullname: (state, action) => {
      state.fullname = action.payload;
    },
    setUserDetails: (state, action) => {
      state.userDetails = action.payload;
    },
    setBaseUrl: (state, action) => {
      state.baseUrl = action.payload;
    },
    setFileid: (state, action) => {
      state.fileId = action.payload;
    },
    setIsWfh: (state, action) => {
      state.isWfh = action.payload;
    },
    setEmployees: (state, action) => {
      state.employees = action.payload;
    },
    
    setEmployeeCode: (state, action) => {
      state.userDetails = state.userDetails || {};
      state.userDetails.employeeCode = action.payload;
    },
  },
  extraReducers: (builder) => builder.addCase("REVERT_ALL", () => initialState),
});

// ✅ Actions
export const {
  setUsername,
  setFullname,
  setUserDetails,
  setBaseUrl,
  setFileid,
  setIsWfh,
  setEmployees,
  setEmployeeCode,
} = UserSlice.actions;

// ✅ Selectors
export const selectBaseUrl = (state) => state.user.baseUrl;
export const selectFileid = (state) => state.user.fileId;
export const selectIsWfh = (state) => state.user.isWfh;
export const selectName = (state) => state.user.fullname;
export const selectUserDetails = (state) => state.user.userDetails;
export const selectEmployeeCode = (state) =>
  state.user.userDetails?.employeeCode ?? null;
export const selectEmployees = (state) => state.user.employees;

export default UserSlice.reducer;

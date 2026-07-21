import { combineReducers } from '@reduxjs/toolkit';

// Import other reducers
import UserSlice from './Slices/UserSlice';
import AuthSlice from './Slices/AuthSlice';
import AttendanceSlice from './Slices/AttendanceSlice';
import QuickAccessSlice from './Slices/QuickAccessSlice';
import notificationSlice from './Slices/notificationSlice';
import AutoAttendanceSlice from './Slices/AutoAttendanceSlice';

const RootReducer = combineReducers({
  user: UserSlice,
  userAuth: AuthSlice,
  attendance: AttendanceSlice,
  quickAccess: QuickAccessSlice,
  notification: notificationSlice,
  autoAttendance: AutoAttendanceSlice,
  // Other individual reducers
});

export default RootReducer;

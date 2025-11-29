import { combineReducers } from '@reduxjs/toolkit';

// Import other reducers
import UserSlice from './Slices/UserSlice';
import AuthSlice from './Slices/AuthSlice';
import AttendanceSlice from './Slices/AttendanceSlice';
import QuickAccessSlice from './Slices/QuickAccessSlice';
import TripDetailsSlice from './Slices/TripDetailsSlice';
import WarehouseSlice from './Slices/Warehouse';
import MaterialRequestSlice from './Slices/MaterialRequestSlice';
const RootReducer = combineReducers({
  user: UserSlice,
  userAuth: AuthSlice,
  attendance: AttendanceSlice,
  quickAccess: QuickAccessSlice,
  tripDetails: TripDetailsSlice,
  warehouse: WarehouseSlice,
  materialRequest: MaterialRequestSlice,
  // Other individual reducers
});

export default RootReducer;

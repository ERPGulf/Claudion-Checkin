import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  AttendanceAction,
  AttendanceCamera,
  AttendanceHistory,
  Notifications,
  SelectQuickAccess,
  LeaveRequest,
  Complaints,
  ExpenseClaim,
  Shortcut1,
  Shortcut2,
  Shortcut3,
  MyQrCode,
} from "../screens";
import HomeTabGroup from "./home.tabbar";
import ComingSoon from "../screens/ComingSoon";
const Stack = createNativeStackNavigator();

function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="homeTab"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="homeTab" component={HomeTabGroup} />
      <Stack.Screen name="Attendance action" component={AttendanceAction} />
      <Stack.Screen name="Attendance camera" component={AttendanceCamera} />
      <Stack.Screen name="Attendance history" component={AttendanceHistory} />
      <Stack.Screen name="Quick access" component={SelectQuickAccess} />
      <Stack.Screen name="Leave request" component={LeaveRequest} />
      <Stack.Screen name="Complaints" component={Complaints} />
      <Stack.Screen name="Expense claim" component={ExpenseClaim} />
      <Stack.Screen name="Shortcut1" component={Shortcut1} />
      <Stack.Screen name="Shortcut2" component={Shortcut2} />
      <Stack.Screen name="Shortcut3" component={Shortcut3} />
      <Stack.Screen name="My QR Code" component={MyQrCode} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="comingsoon" component={ComingSoon} />
    </Stack.Navigator>
  );
}

export default AppNavigator;

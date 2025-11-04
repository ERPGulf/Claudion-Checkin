import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  AttendanceAction,
  AttendanceCamera,
  AttendanceHistory,
  Notifications,
  SelectQuickAccess,
  LeaveRequest,
  ExpenseClaim
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
      <Stack.Screen name="Attendance history" component={AttendanceHistory} />
      <Stack.Screen name="Quick access" component={SelectQuickAccess} />
      <Stack.Screen name="Leave request" component={LeaveRequest} />  
      <Stack.Screen name="Expense claim" component={ExpenseClaim} />
      <Stack.Screen name="Attendance camera" component={AttendanceCamera} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="comingsoon" component={ComingSoon} />
    </Stack.Navigator>
  );
}

export default AppNavigator;

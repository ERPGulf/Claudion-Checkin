import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  AttendanceAction,
  AttendanceCamera,
  AttendanceHistory,
  Notifications,
  SelectQuickAccess,
  LeaveRequest,
  ExpenseClaim,
} from "../screens";
import HomeTabGroup from "./home.tabbar";
import ComingSoon from "../screens/ComingSoon";
import Stocker from "../screens/Stocker/Stocker";
import Scanning from "../screens/Stocker/Scanning";
import ItemDetails from "../screens/Stocker/ItemDetails";
import MaterialRequestDetails from "../screens/Stocker/MaterialRequestDetails";

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
      <Stack.Screen name="Stocker" component={Stocker} />
      <Stack.Screen name="Scanning" component={Scanning} />
      <Stack.Screen name="ItemDetails" component={ItemDetails} />
      <Stack.Screen name="MaterialRequestDetails" component={MaterialRequestDetails} />
      <Stack.Screen name="Quick access" component={SelectQuickAccess} />
      <Stack.Screen name="Leave request" component={LeaveRequest} />
      <Stack.Screen name="Expense claim" component={ExpenseClaim} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="comingsoon" component={ComingSoon} />
    </Stack.Navigator>
  );
}

export default AppNavigator;

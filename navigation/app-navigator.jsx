import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  AttendanceAction,
  AttendanceActionLegacy,
  AttendanceCamera,
  AttendanceHistory,
  AttendanceHistoryLegacy,
  AttendanceRequest,
  AttendanceRequestLegacy,
  Notifications,
  SelectQuickAccess,
  SelectQuickAccessLegacy,
  LeaveRequest,
  Complaints,
  ExpenseClaim,
  Shortcut1,
  Shortcut2,
  Shortcut3,
  MyQrCode,
 
  LoanApplication,
  AutoAttendanceScreen,
  AutoAttendanceLegacy
} from "../screens";
import HomeTabGroup from "./home.tabbar";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from "../hooks/useHomeExperience";
import ComingSoon from "../screens/ComingSoon";
const Stack = createNativeStackNavigator();

function AppNavigator() {
  // TEMPORARY: New Home Experience experiment. On removal, delete this line and
  // pass `SelectQuickAccess` directly below.
  const { enabled: newHomeEnabled } = useHomeExperience();

  return (
    <Stack.Navigator
      initialRouteName="homeTab"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="homeTab" component={HomeTabGroup} />
      <Stack.Screen
        name="Attendance action"
        component={newHomeEnabled ? AttendanceAction : AttendanceActionLegacy}
      />
      <Stack.Screen name="Attendance camera" component={AttendanceCamera} />
      <Stack.Screen
        name="Attendance history"
        component={newHomeEnabled ? AttendanceHistory : AttendanceHistoryLegacy}
      />
      <Stack.Screen
        name="Attendance request"
        component={newHomeEnabled ? AttendanceRequest : AttendanceRequestLegacy}
      />
      <Stack.Screen
        name="Auto attendance"
        component={
          newHomeEnabled ? AutoAttendanceScreen : AutoAttendanceLegacy
        }
      />
      <Stack.Screen
        name="Quick access"
        component={
          newHomeEnabled ? SelectQuickAccess : SelectQuickAccessLegacy
        }
      />
      <Stack.Screen name="Leave request" component={LeaveRequest} />
      <Stack.Screen name="Complaints" component={Complaints} />
      <Stack.Screen name="Expense claim" component={ExpenseClaim} />
      <Stack.Screen name="Shortcut1" component={Shortcut1} />
      <Stack.Screen name="Shortcut2" component={Shortcut2} />
      <Stack.Screen name="Shortcut3" component={Shortcut3} />
      <Stack.Screen name="My QR Code" component={MyQrCode} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="comingsoon" component={ComingSoon} />
      
      <Stack.Screen name="Loan application" component={LoanApplication} />
    </Stack.Navigator>
  );
}

export default AppNavigator;

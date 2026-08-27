import React, { useMemo } from "react";
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
  NotificationsLegacy,
  SelectQuickAccess,
  SelectQuickAccessLegacy,
  LeaveRequest,
  LeaveRequestLegacy,
  Complaints,
  ComplaintsLegacy,
  ExpenseClaim,
  ExpenseClaimLegacy,
  Shortcut1,
  Shortcut2,
  Shortcut3,
  MyQrCode,
  MyQrCodeLegacy,
  LoanApplication,
  LoanApplicationLegacy,
  AutoAttendanceScreen,
  AutoAttendanceLegacy,
} from "../screens";
import HomeTabGroup from "./home.tabbar";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from "../hooks/useHomeExperience";
import ComingSoon from "../screens/ComingSoon";
import withFeatureGate from "./withFeatureGate";
const Stack = createNativeStackNavigator();

function AppNavigator() {
  // TEMPORARY: New Home Experience experiment. On removal, delete this line and
  // pass `SelectQuickAccess` directly below.
  const { enabled: newHomeEnabled } = useHomeExperience();

  /**
   * Feature-gated screens.
   *
   * Routes governed by a server flag keep their registration and answer for
   * themselves — see navigation/withFeatureGate.jsx for why unregistering them
   * would be worse. Every path into a screen (menu tile, pinned shortcut,
   * notification tap, deep link, a stale `navigate()` in code) passes through
   * the component, so this is the one check that cannot be bypassed.
   *
   * Memoised because `withFeatureGate` builds a component: called inline in the
   * JSX below it would produce a new component type on every render, and React
   * Navigation would unmount and remount the screen each time.
   */
  const gated = useMemo(
    () => ({
      attendanceHistory: withFeatureGate(
        "Attendance history",
        newHomeEnabled ? AttendanceHistory : AttendanceHistoryLegacy,
      ),
      attendanceRequest: withFeatureGate(
        "Attendance request",
        newHomeEnabled ? AttendanceRequest : AttendanceRequestLegacy,
      ),
      leaveRequest: withFeatureGate(
        "Leave request",
        newHomeEnabled ? LeaveRequest : LeaveRequestLegacy,
      ),
      complaints: withFeatureGate(
        "Complaints",
        newHomeEnabled ? Complaints : ComplaintsLegacy,
      ),
      loanApplication: withFeatureGate(
        "Loan application",
        newHomeEnabled ? LoanApplication : LoanApplicationLegacy,
      ),
      // The three "Your Records" document screens, all governed by
      // `employee_records`.
      shortcut1: withFeatureGate("Shortcut1", Shortcut1),
      shortcut2: withFeatureGate("Shortcut2", Shortcut2),
      shortcut3: withFeatureGate("Shortcut3", Shortcut3),
    }),
    [newHomeEnabled],
  );

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
        component={gated.attendanceHistory}
      />
      <Stack.Screen
        name="Attendance request"
        component={gated.attendanceRequest}
      />
      <Stack.Screen
        name="Auto attendance"
        component={newHomeEnabled ? AutoAttendanceScreen : AutoAttendanceLegacy}
      />
      <Stack.Screen
        name="Quick access"
        component={newHomeEnabled ? SelectQuickAccess : SelectQuickAccessLegacy}
      />
      <Stack.Screen name="Leave request" component={gated.leaveRequest} />
      <Stack.Screen name="Complaints" component={gated.complaints} />
      <Stack.Screen
        name="Expense claim"
        component={newHomeEnabled ? ExpenseClaim : ExpenseClaimLegacy}
      />
      <Stack.Screen name="Shortcut1" component={gated.shortcut1} />
      <Stack.Screen name="Shortcut2" component={gated.shortcut2} />
      <Stack.Screen name="Shortcut3" component={gated.shortcut3} />
      <Stack.Screen
        name="My QR Code"
        component={newHomeEnabled ? MyQrCode : MyQrCodeLegacy}
      />
      <Stack.Screen
        name="Notifications"
        component={newHomeEnabled ? Notifications : NotificationsLegacy}
      />
      <Stack.Screen name="comingsoon" component={ComingSoon} />

      <Stack.Screen name="Loan application" component={gated.loanApplication} />
    </Stack.Navigator>
  );
}

export default AppNavigator;

import { useEffect, useState, useRef } from "react";
import { useSelector } from "react-redux";
import useAttendanceMeta from "./attendanceAction/useAttendanceMeta";
import useAttendanceBreakFlow from "./attendanceAction/useAttendanceBreakFlow";
import useAttendanceCheckInOut from "./attendanceAction/useAttendanceCheckInOut";
import useAttendanceDevActions from "./attendanceAction/useAttendanceDevActions";

function useAttendanceActionController({ navigation }) {
  const checkin = useSelector((state) => state.attendance.checkin);
  const userDetails = useSelector((state) => state.user.userDetails);
  const breakMinutes = useSelector((state) => state.attendance.breakMinutes);
  const employeeCode = userDetails?.employeeCode;

  const [actionLoading, setActionLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const {
    dateTime,
    distanceInfo,
    isLocationBlocked,
    locationStatusText,
    onRefresh,
    refresh,
    refreshAttendanceData,
    restrictLocation,
    restrictionLoaded,
    syncCheckinFromStatus,
  } = useAttendanceMeta({ employeeCode, isMountedRef });

  const {
    applyDevBreakPreset,
    breakCompleted,
    devBreakMockMode,
    handleBreak,
    liveBreakTime,
    monthlyCapMessage,
    onBreak,
    syncBreakState,
    toggleDevBreakMockMode,
  } = useAttendanceBreakFlow({
    navigation,
    employeeCode,
    checkin,
    breakMinutes,
    isLocationBlocked,
    isMountedRef,
    refreshAttendanceData,
    syncCheckinFromStatus,
    setActionLoading,
  });

  const { handleCheckInOutPress } = useAttendanceCheckInOut({
    navigation,
    checkin,
    employeeCode,
    distanceInfo,
    restrictLocation,
    onBreak,
    refreshAttendanceData,
    syncBreakState,
    setActionLoading,
  });

  const { handleInvalidateAccessToken } = useAttendanceDevActions();

  const breakDisabled =
    actionLoading || isLocationBlocked || breakCompleted || breakMinutes >= 120;

  const breakButtonLabel = breakDisabled
    ? "BREAK NOT ALLOWED"
    : onBreak
      ? "END BREAK"
      : "TAKE BREAK";

  const breakButtonToneClass = breakDisabled
    ? "bg-gray-400"
    : onBreak
      ? "bg-slate-500"
      : "bg-blue-400";

  return {
    actionLoading,
    applyDevBreakPreset,
    breakButtonLabel,
    breakButtonToneClass,
    breakDisabled,
    checkin,
    dateTime,
    devBreakMockMode,
    distanceInfo,
    handleBreak,
    handleCheckInOutPress,
    handleInvalidateAccessToken,
    isLocationBlocked,
    liveBreakTime,
    locationStatusText,
    monthlyCapMessage,
    onBreak,
    onRefresh,
    refresh,
    restrictLocation,
    restrictionLoaded,
    toggleDevBreakMockMode,
  };
}

export default useAttendanceActionController;

import { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setCheckin,
  resetCheckin,
  setBreakMinutes,
  setTodayHours,
  setMonthlyHours,
} from "../../redux/Slices/AttendanceSlice";
import { updateDateTime } from "../../utils/TimeServices";
import {
  getOfficeLocation,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  getServerTime,
  getTodayBreaks,
} from "../../services/api/attendance.service";
import { getTodayString } from "./helpers";

function useAttendanceMeta({ employeeCode, isMountedRef }) {
  const dispatch = useDispatch();

  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(true);
  const [ready, setReady] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [restrictLocation, setRestrictLocation] = useState("0");
  const [restrictionLoaded, setRestrictionLoaded] = useState(false);

  const isLocationBlocked = restrictLocation === "1" && !inTarget;

  const locationStatusText = useMemo(() => {
    if (restrictLocation === "0") return "Not Required";
    if (!ready) return "Getting Location...";
    return inTarget ? "In bound" : "Out of bound";
  }, [restrictLocation, ready, inTarget]);

  useEffect(() => {
    const loadRestriction = async () => {
      const stored = await AsyncStorage.getItem("restrict_location");
      if (!isMountedRef.current) return;
      setRestrictLocation(stored === "1" ? "1" : "0");
      setRestrictionLoaded(true);
    };

    loadRestriction();
  }, [isMountedRef]);

  const syncCheckinFromStatus = useCallback(
    (status) => {
      if (status?.custom_in === 1) {
        dispatch(
          setCheckin({
            checkinTime: Date.now(),
            location: null,
          }),
        );
        return;
      }

      dispatch(resetCheckin());
    },
    [dispatch],
  );

  useEffect(() => {
    const loadCheckinStatus = async () => {
      try {
        const status = await getAttendanceStatus();

        if (!isMountedRef.current) return;
        syncCheckinFromStatus(status);
      } catch (error) {
        console.log("Status sync error:", error);
      }
    };

    if (employeeCode) {
      loadCheckinStatus();
    }
  }, [employeeCode, isMountedRef, syncCheckinFromStatus]);

  const fetchStatusAndLocation = useCallback(async () => {
    setReady(false);

    try {
      if (restrictLocation === "0") {
        setInTarget(true);
        setDistanceInfo(null);
        return;
      }

      const nearest = await getOfficeLocation(employeeCode);
      if (!isMountedRef.current) return;
      setInTarget(nearest.withinRadius);
      setDistanceInfo(nearest);
    } catch (error) {
      if (!isMountedRef.current) return;
      Toast.show({
        type: "error",
        text1: ":warning: Location error",
        text2: error.message,
      });
      setInTarget(false);
    } finally {
      if (!isMountedRef.current) return;
      setReady(true);
    }
  }, [employeeCode, isMountedRef, restrictLocation]);

  const onRefresh = useCallback(() => {
    setRefresh(true);
    fetchStatusAndLocation().finally(() => {
      if (!isMountedRef.current) return;
      setRefresh(false);
    });
  }, [fetchStatusAndLocation, isMountedRef]);

  useEffect(() => {
    if (restrictionLoaded && employeeCode) {
      fetchStatusAndLocation();
    }
  }, [employeeCode, fetchStatusAndLocation, restrictionLoaded]);

  useEffect(() => {
    const loadServerTime = async () => {
      const server = await getServerTime();
      if (!isMountedRef.current) return;
      if (server) setDateTime(updateDateTime(server));
    };

    loadServerTime();
    const intervalId = setInterval(loadServerTime, 10000);

    return () => clearInterval(intervalId);
  }, [isMountedRef]);

  const refreshAttendanceData = useCallback(async () => {
    const todayStr = getTodayString();
    const now = new Date();

    const [todayWorked, monthlyWorked, breakData] = await Promise.all([
      getDailyWorkedHours(employeeCode, todayStr),
      getMonthlyWorkedHours(
        employeeCode,
        now.getMonth() + 1,
        now.getFullYear(),
      ),
      getTodayBreaks(employeeCode, todayStr),
    ]);

    dispatch(setTodayHours(todayWorked ?? "00:00"));
    dispatch(setMonthlyHours(monthlyWorked ?? "00:00"));
    dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

    return breakData;
  }, [dispatch, employeeCode]);

  return {
    dateTime,
    distanceInfo,
    fetchStatusAndLocation,
    inTarget,
    isLocationBlocked,
    locationStatusText,
    onRefresh,
    ready,
    refresh,
    refreshAttendanceData,
    restrictLocation,
    restrictionLoaded,
    syncCheckinFromStatus,
  };
}

export default useAttendanceMeta;

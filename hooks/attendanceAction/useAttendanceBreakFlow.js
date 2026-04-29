import { useEffect, useState, useRef, useCallback } from "react";
import { Alert } from "react-native";
import { useDispatch } from "react-redux";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setCheckin,
  setBreakMinutes,
  setBreakStatus,
} from "../../redux/Slices/AttendanceSlice";
import {
  employeeBreak,
  getAttendanceStatus,
  getTodayBreaks,
} from "../../services/api/attendance.service";
import {
  BREAK_LIMIT_MS,
  findOpenBreak,
  formatSecondsToHms,
  getTodayString,
  isBreakCompleted,
} from "./helpers";

function useAttendanceBreakFlow({
  navigation,
  employeeCode,
  checkin,
  breakMinutes,
  isLocationBlocked,
  isMountedRef,
  refreshAttendanceData,
  syncCheckinFromStatus,
  setActionLoading,
}) {
  const dispatch = useDispatch();

  const [onBreak, setOnBreak] = useState(false);
  const [liveBreakTime, setLiveBreakTime] = useState("00:00:00");
  const [breakStartTime, setBreakStartTime] = useState(null);
  const [breakCompleted, setBreakCompleted] = useState(false);
  const [monthlyCapMessage, setMonthlyCapMessage] = useState("");
  const [devBreakMockMode, setDevBreakMockMode] = useState(false);

  const breakTriggeredRef = useRef(false);

  const syncBreakState = useCallback(async (breakData) => {
    const openBreak = findOpenBreak(breakData);

    if (!openBreak) {
      setOnBreak(false);
      setBreakStartTime(null);
      await AsyncStorage.removeItem("breakStartTime");
      return;
    }

    const isOpen = !openBreak.end || openBreak.end === "";

    setOnBreak(isOpen);

    if (isOpen) breakTriggeredRef.current = false;

    const savedTime = await AsyncStorage.getItem("breakStartTime");

    if (savedTime) {
      setBreakStartTime(parseInt(savedTime, 10));
    } else {
      const backendTime = new Date(openBreak.start).getTime();
      setBreakStartTime(backendTime);
      await AsyncStorage.setItem("breakStartTime", backendTime.toString());
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      try {
        if (!employeeCode) return;

        const status = await getAttendanceStatus();

        if (!isMountedRef.current) return;
        await syncCheckinFromStatus(status);

        const breakData = await refreshAttendanceData();

        if (!isMountedRef.current) return;
        setBreakCompleted(isBreakCompleted(breakData));

        await syncBreakState(breakData);
      } catch (error) {
        console.log("Focus sync error:", error);
      }
    });

    return unsubscribe;
  }, [
    navigation,
    employeeCode,
    isMountedRef,
    refreshAttendanceData,
    syncBreakState,
    syncCheckinFromStatus,
  ]);

  useEffect(() => {
    const loadBreak = async () => {
      if (!employeeCode) return;

      const breakData = await getTodayBreaks(employeeCode, getTodayString());

      if (!isMountedRef.current) return;
      setBreakCompleted(isBreakCompleted(breakData));

      await syncBreakState(breakData);
    };

    loadBreak();
  }, [employeeCode, isMountedRef, syncBreakState]);

  useEffect(() => {
    if (!onBreak || !breakStartTime) {
      setLiveBreakTime("00:00:00");
      return;
    }

    const interval = setInterval(async () => {
      const diff = Date.now() - breakStartTime;
      const currentBreakSeconds = Math.floor(diff / 1000);

      setLiveBreakTime(formatSecondsToHms(currentBreakSeconds));

      if (diff >= BREAK_LIMIT_MS && !breakTriggeredRef.current) {
        breakTriggeredRef.current = true;

        try {
          await employeeBreak({ employeeCode, type: "OUT" });
          await AsyncStorage.removeItem("breakStartTime");

          if (!isMountedRef.current) return;
          setOnBreak(false);
          setBreakStartTime(null);
          setBreakCompleted(true);

          const breakData = await getTodayBreaks(
            employeeCode,
            getTodayString(),
          );

          if (!isMountedRef.current) return;
          dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

          Alert.alert(
            "Break Ended",
            "2-hour break limit reached. Break automatically stopped.",
          );
        } catch {
          Alert.alert("Error", "Auto break end failed");
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [breakStartTime, dispatch, employeeCode, isMountedRef, onBreak]);

  const applyDevBreakPreset = useCallback(
    async (preset) => {
      const now = Date.now();

      const setIdleState = async (minutes, completed = false) => {
        setOnBreak(false);
        setBreakStartTime(null);
        setBreakCompleted(completed);
        setMonthlyCapMessage("");
        breakTriggeredRef.current = false;
        dispatch(setBreakMinutes(minutes));
        dispatch(
          setBreakStatus({
            onBreak: false,
            breakStartTime: null,
          }),
        );
        await AsyncStorage.removeItem("breakStartTime");
      };

      dispatch(
        setCheckin({
          checkinTime: now,
          location: null,
        }),
      );

      if (preset === "idle-0") {
        await setIdleState(0, false);
      }

      if (preset === "idle-45") {
        await setIdleState(45, false);
      }

      if (preset === "running-30") {
        const startTime = now - 30 * 60 * 1000;
        setOnBreak(true);
        setBreakStartTime(startTime);
        setBreakCompleted(false);
        breakTriggeredRef.current = false;
        dispatch(setBreakMinutes(45));
        dispatch(
          setBreakStatus({
            onBreak: true,
            breakStartTime: startTime,
          }),
        );
        await AsyncStorage.setItem("breakStartTime", String(startTime));
      }

      if (preset === "cap-120") {
        await setIdleState(120, false);
      }

      if (preset === "completed") {
        await setIdleState(60, true);
      }

      if (preset === "monthly-cap") {
        await setIdleState(30, true);
        setMonthlyCapMessage("Monthly break limit reached (8h)");
        Toast.show({
          type: "error",
          text1: "Monthly break limit reached (8h)",
        });
      }

      if (__DEV__) {
        setDevBreakMockMode(true);
      }

      Toast.show({
        type: "success",
        text1: `DEV preset applied: ${preset}`,
      });
    },
    [dispatch],
  );

  const toggleDevBreakMockMode = useCallback(() => {
    setDevBreakMockMode((prev) => !prev);
  }, []);

  const handleBreak = useCallback(async () => {
    if (!checkin) {
      Toast.show({ type: "error", text1: "Please check-in first" });
      return;
    }

    if (isLocationBlocked) {
      Toast.show({
        type: "error",
        text1: "You are out of allowed location",
      });
      return;
    }

    if (__DEV__ && devBreakMockMode) {
      try {
        setActionLoading(true);

        if (!onBreak) {
          const startTime = Date.now();
          setOnBreak(true);
          setBreakStartTime(startTime);
          setBreakCompleted(false);
          setMonthlyCapMessage("");
          breakTriggeredRef.current = false;

          dispatch(
            setBreakStatus({
              onBreak: true,
              breakStartTime: startTime,
            }),
          );
          await AsyncStorage.setItem("breakStartTime", String(startTime));

          Toast.show({ type: "success", text1: "DEV break started (local)" });
          return;
        }

        const elapsedMinutes = Math.max(
          0,
          Math.floor((Date.now() - breakStartTime) / 60000),
        );
        const nextTotal = Math.min(120, (breakMinutes ?? 0) + elapsedMinutes);

        setOnBreak(false);
        setBreakStartTime(null);
        setBreakCompleted(true);
        setMonthlyCapMessage("");
        dispatch(setBreakMinutes(nextTotal));
        dispatch(
          setBreakStatus({
            onBreak: false,
            breakStartTime: null,
          }),
        );
        await AsyncStorage.removeItem("breakStartTime");

        Toast.show({
          type: "success",
          text1: `DEV break ended (total: ${nextTotal}m)`,
        });
        return;
      } finally {
        setActionLoading(false);
      }
    }

    const breakDataCheck = await getTodayBreaks(employeeCode, getTodayString());

    if (isBreakCompleted(breakDataCheck)) {
      Toast.show({
        type: "error",
        text1: "Break already completed for today",
      });
      return;
    }

    const type = onBreak ? "OUT" : "IN";

    try {
      setActionLoading(true);
      const response = await employeeBreak({ employeeCode, type });

      if (!response.allowed) {
        if (response.message?.includes("Monthly break limit")) {
          setBreakCompleted(true);
          setMonthlyCapMessage(response.message);
        } else {
          setMonthlyCapMessage("");
        }

        Toast.show({ type: "error", text1: response.message });
        return;
      }

      if (type === "IN") {
        const startTime = Date.now();

        setOnBreak(true);
        setBreakStartTime(startTime);
        setMonthlyCapMessage("");

        await AsyncStorage.setItem("breakStartTime", startTime.toString());
      } else {
        setOnBreak(false);
        setBreakStartTime(null);
        setMonthlyCapMessage("");

        await AsyncStorage.removeItem("breakStartTime");
      }

      const breakData = await getTodayBreaks(employeeCode, getTodayString());

      setBreakCompleted(isBreakCompleted(breakData));
      dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

      await syncBreakState(breakData);

      Toast.show({ type: "success", text1: response.message });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Break failed",
        text2: error.message,
      });
    } finally {
      setActionLoading(false);
    }
  }, [
    breakMinutes,
    breakStartTime,
    checkin,
    devBreakMockMode,
    dispatch,
    employeeCode,
    isLocationBlocked,
    onBreak,
    setActionLoading,
    syncBreakState,
  ]);

  return {
    applyDevBreakPreset,
    breakCompleted,
    devBreakMockMode,
    handleBreak,
    liveBreakTime,
    monthlyCapMessage,
    onBreak,
    syncBreakState,
    toggleDevBreakMockMode,
  };
}

export default useAttendanceBreakFlow;

import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Alert,
  StyleSheet,
} from "react-native";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setCheckin,
  setCheckout,
  resetCheckin,
  setBreakMinutes,
  setBreakStatus,
  setTodayHours,
  setMonthlyHours,
} from "../redux/Slices/AttendanceSlice";
import { COLORS, SIZES } from "../constants";
import WelcomeCard from "../components/AttendanceAction/WelcomeCard";
import DevPanel from "../components/AttendanceAction/DevPanel";
import BreakTimerCard from "../components/AttendanceAction/BreakTimerCard";
import CheckinButton from "../components/AttendanceAction/CheckinButton";
import BreakButton from "../components/AttendanceAction/BreakButton";
import AttendanceInfo from "../components/AttendanceAction/AttendanceInfo";
import { updateDateTime } from "../utils/TimeServices";
import { saveTokens } from "../services/api/apiClient";
import {
  getOfficeLocation,
  userCheckIn,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  getServerTime,
  employeeBreak,
  getTodayBreaks,
} from "../services/api/attendance.service";
import {
  clearPersistedCheckinStartTime,
  getPersistedSessionTimes,
  persistCheckinStartTime,
  persistCheckoutTime,
  resolveActiveSessionStart,
} from "../utils/attendanceSession";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const BREAK_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Returns today's date formatted as DD-MM-YYYY */
const getTodayString = () =>
  new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

function AttendanceAction() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const checkin = useSelector((state) => state.attendance.checkin);
  const checkinTime = useSelector((state) => state.attendance.checkinTime);
  const checkinLocation = useSelector((state) => state.attendance.location);
  const userDetails = useSelector((state) => state.user.userDetails);
  const breakMinutes = useSelector((state) => state.attendance.breakMinutes);
  const employeeCode = userDetails?.employeeCode;
  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(true);
  const [ready, setReady] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [restrictLocation, setRestrictLocation] = useState("0");
  const [restrictionLoaded, setRestrictionLoaded] = useState(false);
  const [onBreak, setOnBreak] = useState(false);
  const [liveBreakTime, setLiveBreakTime] = useState("00:00:00");
  const [breakStartTime, setBreakStartTime] = useState(null);
  const breakTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const [breakCompleted, setBreakCompleted] = useState(false);
  const [monthlyCapMessage, setMonthlyCapMessage] = useState("");
  const [devBreakMockMode, setDevBreakMockMode] = useState(false);
  const isBreakCompleted = (breakData) => {
    if (!breakData?.breaks?.length) return false;

    const hasIn = breakData.breaks.some((b) => b.start);
    const hasOut = breakData.breaks.some((b) => b.end);

    return hasIn && hasOut;
  };
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance Action",
      headerTitleAlign: "center",
      statusBarTranslucent: false,
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Load location restriction
  useEffect(() => {
    const loadRestriction = async () => {
      const r = await AsyncStorage.getItem("restrict_location");
      if (!isMountedRef.current) return;
      setRestrictLocation(r === "1" ? "1" : "0");
      setRestrictionLoaded(true);
    };
    loadRestriction();
  }, []);

  const syncCheckinFromStatus = useCallback(
    async (status) => {
      const { checkinStartTime, lastCheckoutTime } =
        await getPersistedSessionTimes();

      const resolvedStart = resolveActiveSessionStart({
        status,
        storedCheckinStartTime: checkinStartTime,
        reduxCheckinTime: checkinTime,
        lastCheckoutTime,
      });

      if (resolvedStart) {
        const persistedStart = await persistCheckinStartTime(resolvedStart);

        dispatch(
          setCheckin({
            checkinTime: persistedStart,
            location: checkinLocation,
          }),
        );
        return;
      }

      await clearPersistedCheckinStartTime();
      dispatch(resetCheckin());
    },
    [checkinLocation, checkinTime, dispatch],
  );

  useEffect(() => {
    const loadCheckinStatus = async () => {
      try {
        const res = await getAttendanceStatus();

        if (!isMountedRef.current) return;

        await syncCheckinFromStatus(res);
      } catch (e) {
        console.log("Status sync error:", e);
      }
    };

    if (employeeCode) {
      loadCheckinStatus();
    }
  }, [employeeCode, syncCheckinFromStatus]);

  const fetchStatusAndLocation = useCallback(async () => {
    try {
      setReady(false);

      if (restrictLocation === "0") {
        setInTarget(true);
        setDistanceInfo(null);
        setReady(true);
        return;
      }

      const nearest = await getOfficeLocation(employeeCode);
      if (!isMountedRef.current) return;
      setInTarget(nearest.withinRadius);
      setDistanceInfo(nearest);
      setReady(true);
    } catch (error) {
      if (!isMountedRef.current) return;
      Toast.show({
        type: "error",
        text1: ":warning: Location error",
        text2: error.message,
      });
      setInTarget(false);
      setReady(true);
    }
  }, [restrictLocation, employeeCode]);

  // Fetch GPS on mount
  useEffect(() => {
    if (restrictionLoaded && employeeCode) fetchStatusAndLocation();
  }, [restrictionLoaded, employeeCode, fetchStatusAndLocation]);

  // Update date & time every 10 seconds
  useEffect(() => {
    const loadServerTime = async () => {
      const server = await getServerTime();
      if (!isMountedRef.current) return;
      if (server) setDateTime(updateDateTime(server));
    };

    loadServerTime();
    const intervalId = setInterval(loadServerTime, 10000);
    return () => clearInterval(intervalId);
  }, []);

  /**
   * Dispatches today + monthly worked hours and break minutes to Redux.
   * Avoids duplicating three identical Promise.all blocks across handlers.
   */
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

  /**
   * Syncs onBreak / breakStartTime state from a breakData response object.
   */

  const syncBreakState = useCallback(async (breakData) => {
    const lastBreak = breakData?.breaks?.find((b) => !b.end || b.end === null);

    if (!lastBreak) {
      setOnBreak(false);
      setBreakStartTime(null);
      await AsyncStorage.removeItem("breakStartTime"); // ✅ keep storage clean
      return;
    }

    const isOpen =
      !lastBreak.end || lastBreak.end === "" || lastBreak.end === null;

    setOnBreak(isOpen);

    if (isOpen) breakTriggeredRef.current = false;

    const savedTime = await AsyncStorage.getItem("breakStartTime");

    if (savedTime) {
      setBreakStartTime(parseInt(savedTime));
    } else {
      const backendTime = new Date(lastBreak.start).getTime();
      setBreakStartTime(backendTime);

      await AsyncStorage.setItem("breakStartTime", backendTime.toString());
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      try {
        if (!employeeCode) return;

        // ✅ 1. FIRST: sync attendance status
        const res = await getAttendanceStatus();

        console.log("FOCUS STATUS:", res.custom_in);

        if (!isMountedRef.current) return;

        await syncCheckinFromStatus(res);

        // ✅ 2. THEN: fetch totals
        const breakData = await refreshAttendanceData();

        if (!isMountedRef.current) return;
        setBreakCompleted(isBreakCompleted(breakData));

        syncBreakState(breakData);
      } catch (e) {
        console.log("Focus sync error:", e);
      }
    });

    return unsubscribe;
  }, [
    navigation,
    employeeCode,
    refreshAttendanceData,
    syncBreakState,
    syncCheckinFromStatus,
  ]);

  useEffect(() => {
    const loadBreak = async () => {
      const saved = await AsyncStorage.getItem("breakStartTime");
      const breakData = await getTodayBreaks(employeeCode, getTodayString());
      setBreakCompleted(isBreakCompleted(breakData));

      if (saved) {
        const parsedTime = parseInt(saved);

        setBreakStartTime(parsedTime);
        setOnBreak(true);
      }
    };

    loadBreak();
  }, []);

  useEffect(() => {
    if (!onBreak || !breakStartTime) {
      setLiveBreakTime("00:00:00");
      return;
    }

    const interval = setInterval(async () => {
      const diff = Date.now() - breakStartTime;
      const currentBreakSeconds = Math.floor(diff / 1000);

      const hrs = String(Math.floor(currentBreakSeconds / 3600)).padStart(
        2,
        "0",
      );
      const mins = String(
        Math.floor((currentBreakSeconds % 3600) / 60),
      ).padStart(2, "0");
      const secs = String(currentBreakSeconds % 60).padStart(2, "0");
      setLiveBreakTime(`${hrs}:${mins}:${secs}`);

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
    console.log("BREAK START TIME:", breakStartTime);
    console.log("NOW:", Date.now());
    console.log("DIFF MIN:", (Date.now() - breakStartTime) / 60000);

    return () => clearInterval(interval);
  }, [onBreak, breakStartTime, dispatch, employeeCode]);

  const handleDirectCheckInOut = useCallback(
    async (type) => {
      try {
        setActionLoading(true);
        const response = await userCheckIn({
          employeeCode,
          type,
          locationData: distanceInfo,
        });

        if (!response.allowed) {
          Toast.show({
            type: "error",
            text1: ":warning: Action blocked",
            text2: response.message,
          });
          return;
        }

        if (type === "IN") {
          const startedAt = await persistCheckinStartTime(Date.now());

          dispatch({ type: "attendance/setSelectedLocation", payload: null });
          dispatch(
            setCheckin({
              checkinTime: startedAt,
              location: restrictLocation === "1" ? response.location : null,
            }),
          );
        } else {
          if (onBreak) {
            const breakRes = await employeeBreak({
              employeeCode,
              type: "OUT",
            });
            if (!breakRes?.allowed) {
              console.log("Break already ended from backend");
            }
          }

          const checkedOutAt = await persistCheckoutTime(Date.now());

          dispatch(setCheckout({ checkoutTime: checkedOutAt }));
          dispatch({ type: "attendance/setSelectedLocation", payload: null });
        }

        const breakData = await refreshAttendanceData();
        syncBreakState(breakData);

        Toast.show({
          type: "success",
          text1: type === "IN" ? "Checked in!" : "Checked out!",
        });
      } catch (error) {
        console.log("AttendanceAction.handleDirectCheckInOut error:", {
          errorMessage: error?.message,
          status: error?.response?.status,
          responseData: error?.response?.data,
        });

        Toast.show({
          type: "error",
          text1: ":warning: Failed",
          text2:
            error?.response?.data?.message ||
            error?.response?.data ||
            error.message ||
            "Request failed",
        });
      } finally {
        setActionLoading(false);
      }
    },
    [
      employeeCode,
      distanceInfo,
      restrictLocation,
      onBreak,
      dispatch,
      refreshAttendanceData,
      syncBreakState,
    ],
  );

  const handleInvalidateAccessToken = useCallback(async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("refresh_token");

      if (!refreshToken) {
        Toast.show({
          type: "error",
          text1: "Refresh token missing",
          text2: "Cannot invalidate access token without a refresh token.",
        });
        return;
      }

      await saveTokens("invalid-access-token-123", refreshToken);
      const maskedRefresh = `${refreshToken.slice(0, 6)}...${refreshToken.slice(-4)}`;
      Toast.show({
        type: "success",
        text1: "Dev token invalidated",
        text2: `Refresh token preserved: ${maskedRefresh}`,
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Dev token reset failed",
        text2: error.message || "Unable to invalidate access token.",
      });
    }
  }, []);

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

  const handleBreak = useCallback(async () => {
    if (!checkin) {
      Toast.show({ type: "error", text1: "Please check-in first" });
      return;
    }

    if (restrictLocation === "1" && !inTarget) {
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

    // ✅ FIRST check from backend (important)
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
        // ✅ Handle monthly limit from backend
        if (response.message?.includes("Monthly break limit")) {
          setBreakCompleted(true); // disable button
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

      // ✅ Fetch latest break data
      const breakData = await getTodayBreaks(employeeCode, getTodayString());

      setBreakCompleted(isBreakCompleted(breakData));
      dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

      syncBreakState(breakData);

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
    checkin,
    restrictLocation,
    inTarget,
    onBreak,
    devBreakMockMode,
    breakMinutes,
    breakStartTime,
    dispatch,
  ]);

  // Temporary loading screen
  if (!restrictionLoaded) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: "white" }}
        edges={["bottom", "left", "right"]}
      >
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text className="mt-2 text-gray-600">Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }
  const handleCheckinPress = async () => {
    try {
      const photoValue = await AsyncStorage.getItem("photo");

      const actionType = checkin ? "OUT" : "IN";

      if (photoValue !== "1") {
        await handleDirectCheckInOut(actionType);
      } else {
        navigation.navigate("Attendance camera", {
          type: actionType,
        });
      }
    } catch (error) {
      Toast.show({
        type: "error",
        text1: ":warning: Action failed",
        text2: error.message,
      });
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "white" }}
      edges={["bottom", "left", "right"]}
    >
      {actionLoading && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 50,
              backgroundColor: "rgba(0,0,0,0.5)",
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            },
          ]}
          className="items-center justify-center"
        >
          <ActivityIndicator size="large" color="white" />
          <Text className="text-white mt-2 text-base">Processing...</Text>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          backgroundColor: "white",
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            onRefresh={() => {
              setRefresh(true);
              fetchStatusAndLocation().finally(() => setRefresh(false));
            }}
          />
        }
      >
        <View style={{ width: "100%" }} className="flex-1 px-3">
          {onBreak && <BreakTimerCard liveBreakTime={liveBreakTime} />}
          <WelcomeCard />
          {__DEV__ && (
            <DevPanel
              devBreakMockMode={devBreakMockMode}
              setDevBreakMockMode={setDevBreakMockMode}
              applyDevBreakPreset={applyDevBreakPreset}
              handleInvalidateAccessToken={handleInvalidateAccessToken}
            />
          )}
          <View className="h-72 mt-4 mb-24">
            <View className="p-3">
              {/* DATE & TIME */}
              <AttendanceInfo
                dateTime={dateTime}
                restrictLocation={restrictLocation}
                ready={ready}
                inTarget={inTarget}
                distanceInfo={distanceInfo}
              />

              {/* CHECK-IN / CHECK-OUT BUTTON */}
              <CheckinButton
                checkin={checkin}
                actionLoading={actionLoading}
                disabled={restrictLocation === "1" && !inTarget}
                onPress={handleCheckinPress}
              />
              {/* BREAK BUTTON */}
              {checkin && (
                <BreakButton
                  actionLoading={actionLoading}
                  restrictLocation={restrictLocation}
                  inTarget={inTarget}
                  breakCompleted={breakCompleted}
                  breakMinutes={breakMinutes}
                  onBreak={onBreak}
                  onPress={handleBreak}
                  monthlyCapMessage={monthlyCapMessage}
                />
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
export default AttendanceAction;

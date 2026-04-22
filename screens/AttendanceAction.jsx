import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import * as Location from "expo-location";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import {
  setCheckin,
  setCheckout,
  setBreakMinutes,
} from "../redux/Slices/AttendanceSlice";
import { Alert } from "react-native";
import { COLORS, SIZES } from "../constants";
import WelcomeCard from "../components/AttendanceAction/WelcomeCard";
import { updateDateTime } from "../utils/TimeServices";
import {
  getOfficeLocation,
  userCheckIn,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  getServerTime,
  employeeBreak,
  getTodayBreaks,
} from "../services/api/attendance.service";
import { SafeAreaView } from "react-native-safe-area-context";
function AttendanceAction() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const checkin = useSelector((state) => state.attendance.checkin);
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
  // const BREAK_LIMIT = 2 * 60 * 60 * 1000;
  const breakTriggeredRef = useRef(false);
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance Action",
      headerTitleAlign: "center",
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
      setRestrictLocation(r === "1" ? "1" : "0");
      setRestrictionLoaded(true);
    };
    loadRestriction();
  }, []);

  const fetchStatusAndLocation = async () => {
    try {
      setReady(false);

      if (restrictLocation === "0") {
        setInTarget(true);
        setDistanceInfo(null);
        setReady(true);
        return;
      }

      const nearest = await getOfficeLocation(employeeCode);
      setInTarget(nearest.withinRadius);
      setDistanceInfo(nearest);
      setReady(true);
    } catch (error) {
      Toast.show({
        type: "error",
        text1: ":warning: Location error",
        text2: error.message,
      });
      setInTarget(false);
      setReady(true);
    }
  };

  // Fetch GPS on mount
  useEffect(() => {
    if (restrictionLoaded && employeeCode) fetchStatusAndLocation();
  }, [restrictionLoaded, employeeCode]);

  // Update date & time every 9 seconds
  useEffect(() => {
    const loadServerTime = async () => {
      const server = await getServerTime();
      if (server) {
        setDateTime(updateDateTime(server));
      }
    };

    loadServerTime();
    const intervalId = setInterval(loadServerTime, 10000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      if (employeeCode) {
        const today = new Date();
        const todayFormatted = today
          .toLocaleDateString("en-GB")
          .replace(/\//g, "-");

        const month = today.getMonth() + 1;
        const year = today.getFullYear();

        const [todayWorked, monthlyWorked, breakData] = await Promise.all([
          getDailyWorkedHours(employeeCode, todayFormatted),
          getMonthlyWorkedHours(employeeCode, month, year),
          getTodayBreaks(employeeCode, todayFormatted),
        ]);

        dispatch({
          type: "attendance/setTodayHours",
          payload: todayWorked ?? "00:00",
        });

        dispatch({
          type: "attendance/setMonthlyHours",
          payload: monthlyWorked ?? "00:00",
        });

        dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

        const lastBreak = breakData?.breaks?.slice(-1)[0];
        if (!lastBreak) {
          setOnBreak(false);
          setBreakStartTime(null);
        } else {
          const isBreakOpen =
            !lastBreak.end || lastBreak.end === "" || lastBreak.end === null;

          setOnBreak(isBreakOpen);

          if (isBreakOpen) {
            // setBreakStartTime(new Date(lastBreak.start).getTime());
            setBreakStartTime(Date.now()); // ✅ always device time
            breakTriggeredRef.current = false;
          } else {
            setBreakStartTime(null);
          }
        }
      }
    });

    return unsubscribe;
  }, [navigation, employeeCode]);

 
  useEffect(() => {
    if (!onBreak || !breakStartTime) {
      setLiveBreakTime("00:00:00");
      return;
    }

    const BREAK_LIMIT = 2 * 60 * 60; // seconds

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - breakStartTime;

      const currentBreakSeconds = Math.floor(diff / 1000);

      // ✅ FREEZE when limit reached
      if (currentBreakSeconds >= BREAK_LIMIT) {
        if (!breakTriggeredRef.current) {
          breakTriggeredRef.current = true;
          Alert.alert("Break Limit", "You have reached 2 hours break time");
        }

        // 🔴 Freeze at exactly 02:00:00
        setLiveBreakTime("02:00:00");

        return; // ⛔ STOP further updates
      }

      // ✅ Normal timer
      const hrs = String(Math.floor(currentBreakSeconds / 3600)).padStart(
        2,
        "0",
      );
      const mins = String(
        Math.floor((currentBreakSeconds % 3600) / 60),
      ).padStart(2, "0");
      const secs = String(currentBreakSeconds % 60).padStart(2, "0");

      setLiveBreakTime(`${hrs}:${mins}:${secs}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [onBreak, breakStartTime]);

  // Check-in / Check-out handler
  const handleDirectCheckInOut = async (type) => {
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
        dispatch({ type: "attendance/setSelectedLocation", payload: null });

        dispatch(
          setCheckin({
            checkinTime: Date.now(),
            location: restrictLocation === "1" ? response.location : null,
          }),
        );
      } else {
        if (onBreak) {
          const breakRes = await employeeBreak({
            employeeCode,
            type: "OUT",
          });

          // If backend already ended break, ignore safely
          if (!breakRes?.allowed) {
            console.log("Break already ended from backend");
          }
        }

        dispatch(
          setCheckout({
            checkoutTime: Date.now(),
          }),
        );
        breakTriggeredRef.current = false;
        dispatch({ type: "attendance/setSelectedLocation", payload: null });

        // Refresh break data
        const today = new Date();
        const todayFormatted = today
          .toLocaleDateString("en-GB")
          .replace(/\//g, "-");

        const breakData = await getTodayBreaks(employeeCode, todayFormatted);

        dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));
        const lastBreak = breakData?.breaks?.slice(-1)[0];

        if (!lastBreak) {
          setOnBreak(false);
        } else {
          const isBreakOpen =
            !lastBreak.end || lastBreak.end === "" || lastBreak.end === null;

          setOnBreak(isBreakOpen);
        }
      }

      // Refresh totals
      const today = new Date();
      const todayFormatted = today
        .toLocaleDateString("en-GB")
        .replace(/\//g, "-");
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      const [todayWorked, monthlyWorked, breakData] = await Promise.all([
        getDailyWorkedHours(employeeCode, todayFormatted),
        getMonthlyWorkedHours(employeeCode, month, year),
        getTodayBreaks(employeeCode, todayFormatted),
      ]);

      dispatch({
        type: "attendance/setTodayHours",
        payload: todayWorked ?? "00:00",
      });

      dispatch({
        type: "attendance/setMonthlyHours",
        payload: monthlyWorked ?? "00:00",
      });

      dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));
      Toast.show({
        type: "success",
        text1: type === "IN" ? "Checked in!" : "Checked out!",
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: ":warning: Failed",
        text2: error.message,
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBreak = async () => {
    if (!checkin) {
      Toast.show({
        type: "error",
        text1: "Please check-in first",
      });
      return;
    }

    if (restrictLocation === "1" && !inTarget) {
      Toast.show({
        type: "error",
        text1: "You are out of allowed location",
      });
      return;
    }

    const type = onBreak ? "OUT" : "IN";

    try {
      setActionLoading(true);

      const response = await employeeBreak({
        employeeCode,
        type,
      });

      if (!response.allowed) {
        Toast.show({
          type: "error",
          text1: response.message,
        });
        return;
      }

      const today = new Date();
      const todayFormatted = today
        .toLocaleDateString("en-GB")
        .replace(/\//g, "-");

      const breakData = await getTodayBreaks(employeeCode, todayFormatted);

      dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

      const lastBreak = breakData?.breaks?.slice(-1)[0];

      if (!lastBreak) {
        setOnBreak(false);
        setBreakStartTime(null);
      } else {
        const isBreakOpen =
          !lastBreak.end || lastBreak.end === "" || lastBreak.end === null;

        setOnBreak(isBreakOpen);

        // if (isBreakOpen) {
        //   setBreakStartTime(new Date(lastBreak.start).getTime());
        // } else {
        //   setBreakStartTime(null);
        // }
        // if (isBreakOpen) {
        //   setBreakStartTime(new Date(lastBreak.start).getTime());
        // } else {
        //   setBreakStartTime(null);
        //   setLiveBreakTime("00:00:00"); // ✅ reset UI
        // }
        if (!onBreak) {
          const startTime = Date.now(); // ✅ device time

          setBreakStartTime(startTime);
          setLiveBreakTime("00:00:00");
          breakTriggeredRef.current = false;
        }
      }
      Toast.show({
        type: "success",
        text1: response.message,
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Break failed",
        text2: error.message,
      });
    } finally {
      setActionLoading(false);
    }
  };
  // Temporary loading screen
  if (!restrictionLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text className="mt-2 text-gray-600">Loading settings...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "white" }}>
      <>
        {actionLoading && (
          <View className="absolute top-0 left-0 h-screen w-screen bg-black/50 z-50 items-center justify-center">
            <ActivityIndicator size="large" color="white" />
            <Text className="text-white mt-2 text-base">Processing...</Text>
          </View>
        )}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flex: 1,
            alignItems: "center",
            backgroundColor: "white",
            paddingVertical: 16,
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
            <WelcomeCard />
            <View className="h-72 mt-4">
              <View className="p-3">
                {/* DATE & TIME */}
                <Text className="text-base text-gray-500 font-semibold">
                  DATE AND TIME *
                </Text>
                <View className="flex-row items-end border-b border-gray-400 pb-2 mb-6 justify-between">
                  <Text className="text-sm font-medium text-gray-500">
                    {dateTime}
                  </Text>
                  <MaterialCommunityIcons
                    name="calendar-month"
                    size={28}
                    color={COLORS.gray}
                  />
                </View>
                {/* LOCATION */}
                <Text className="text-base text-gray-500 font-semibold">
                  LOCATION *
                </Text>
                <View className="flex-row items-end border-b border-gray-400 pb-2 mb-4 justify-between">
                  <Text className="text-sm font-medium text-gray-500">
                    {restrictLocation === "0"
                      ? "Not Required"
                      : !ready
                        ? "Getting Location..."
                        : // : distanceInfo?.locationName
                          //   ? distanceInfo.locationName
                          inTarget
                          ? "In bound"
                          : "Out of bound"}
                  </Text>

                  <MaterialCommunityIcons
                    name="map-marker-radius-outline"
                    size={28}
                    color={COLORS.gray}
                  />
                </View>
                {restrictLocation === "1" && distanceInfo && (
                  <View className="mb-3">
                    <Text className="text-xs text-gray-400">
                      Distance: {distanceInfo.distance} m | Allowed:{" "}
                      {distanceInfo.radius} m
                    </Text>
                  </View>
                )}

                {/* CHECK-IN / CHECK-OUT BUTTON */}
                <TouchableOpacity
                  className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${
                    checkin ? "bg-red-600" : "bg-green-600"
                  } ${restrictLocation === "1" && !inTarget ? "opacity-50" : ""}`}
                  disabled={
                    actionLoading || (restrictLocation === "1" && !inTarget)
                  }
                  onPress={async () => {
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
                  }}
                >
                  <Text className="text-xl font-bold text-white">
                    {checkin ? "CHECK-OUT" : "CHECK-IN"}
                  </Text>
                </TouchableOpacity>
                {/* BREAK BUTTON */}
                {checkin && (
                  <View>
                    <TouchableOpacity
                      className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${
                        onBreak ? "bg-slate-500" : "bg-blue-400"
                      } ${restrictLocation === "1" && !inTarget ? "opacity-50" : ""}`}
                      disabled={
                        actionLoading || (restrictLocation === "1" && !inTarget)
                      }
                      onPress={handleBreak}
                    >
                      <Text className="text-xl font-bold text-white">
                        {onBreak ? "END BREAK" : "TAKE BREAK"}
                      </Text>
                    </TouchableOpacity>

                    {onBreak && (
                      <Text className="text-lg font-bold text-black text-center mt-2">
                        Break Time running : {liveBreakTime || "00:00:00"}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </>
    </SafeAreaView>
  );
}
export default AttendanceAction;

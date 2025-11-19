import React, { useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import * as Location from "expo-location";
import { MaterialCommunityIcons, Entypo } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import { setOnlyCheckIn } from "../redux/Slices/AttendanceSlice";
import { COLORS, SIZES } from "../constants";
import { Retry, WelcomeCard } from "../components/AttendanceAction";
import { updateDateTime } from "../utils/TimeServices";
import { hapticsMessage } from "../utils/HapticsMessage";
import { getOfficeLocation, userCheckIn } from "../services/api";
// import { userCheckIn, getOfficeLocation } from "../api/userApi";

function AttendanceAction() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const checkin = useSelector((state) => state.attendance.checkin);
  const userDetails = useSelector((state) => state.user.userDetails);
  const employeeCode = userDetails?.employeeCode;

  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(false);
  const [ready, setReady] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [actionLoading, setActionLoading] = useState(false); // NEW

  // HANDLE CHECK-IN / OUT
  const handleDirectCheckInOut = async (type) => {
    try {
      setActionLoading(true);

      const response = await userCheckIn({ employeeCode, type });

      if (!response) {
        throw new Error("No response from check-in function");
      }

      if (!response.allowed) {
        Toast.show({
          type: "error",
          text1: "⚠️ Check-in blocked",
          text2: response.message || "You are outside the allowed area",
        });

        setInTarget(false);
        setDistanceInfo({
          distance: response.distance,
          radius: response.radius,
        });

        return;
      }

      dispatch(setOnlyCheckIn(type === "IN"));

      Toast.show({
        type: "success",
        text1: type === "IN" ? "Checked in!" : "Checked out!",
      });

      setInTarget(true);
      setDistanceInfo({ distance: response.distance, radius: response.radius });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: `⚠️ ${type} failed`,
        text2: error.message || "Please try again",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // HEADER CONFIG
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance action",
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
  }, []);

  // FETCH LOCATION + STATUS
  const fetchStatusAndLocation = async () => {
    try {
      setReady(false);

      const office = await getOfficeLocation(employeeCode);

      if (!office || !office.latitude || !office.longitude || !office.radius) {
        throw new Error("Reporting location not configured");
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        throw new Error("Location permission denied");
      }

      const liveLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const userCords = {
        latitude: liveLoc.coords.latitude,
        longitude: liveLoc.coords.longitude,
      };

      const targetLocation = {
        latitude: office.latitude,
        longitude: office.longitude,
      };

      const distance = getPreciseDistance(userCords, targetLocation);
      const inside = distance <= office.radius;

      setInTarget(inside);
      setDistanceInfo({ distance, radius: office.radius });
      setReady(true);
    } catch (error) {
      console.error("❌ Status/location fetch failed:", error);
      hapticsMessage("error");

      Toast.show({
        type: "error",
        text1: "⚠️ Status fetching failed",
        text2: error.message || "Please try again",
      });

      setReady(false);
      setInTarget(false);
      setDistanceInfo(null);
    }
  };

  useEffect(() => {
    if (employeeCode) fetchStatusAndLocation();
  }, [employeeCode]);

  useEffect(() => {
    const update = () => setDateTime(updateDateTime());
    update();
    const intervalId = setInterval(update, 9000);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <>
      {/* FULL PAGE LOADING WHEN CHECK-IN/OUT */}
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
        {!ready && (
          <View className="h-screen absolute bottom-0 w-screen items-center bg-black/50 justify-center z-40">
            <ActivityIndicator size="large" color="white" />
          </View>
        )}

        <View style={{ width: "100%" }} className="flex-1 px-3">
          <WelcomeCard />

          <View className="h-72 mt-4">
            <View className="p-3">
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

              <Text className="text-base text-gray-500 font-semibold">
                LOCATION *
              </Text>

              <View className="flex-row items-end border-b border-gray-400 pb-2 mb-4 justify-between">
                <Text className="text-sm font-medium text-gray-500">
                  {!ready ? (
                    <ActivityIndicator size="small" />
                  ) : inTarget ? (
                    "In bound"
                  ) : (
                    "Out of bound"
                  )}
                </Text>
                <MaterialCommunityIcons
                  name="map-marker-radius-outline"
                  size={28}
                  color={COLORS.gray}
                />
              </View>

              {distanceInfo && (
                <View className="mb-3">
                  <Text className="text-xs text-gray-400">
                    Distance: {distanceInfo.distance} m | Allowed:{" "}
                    {distanceInfo.radius} m
                  </Text>
                </View>
              )}

              <TouchableOpacity
                className={`justify-center items-center h-16 mt-4 rounded-2xl ${
                  checkin ? "bg-red-600" : "bg-green-600"
                } ${!inTarget || actionLoading ? "opacity-50" : ""}`}
                disabled={!ready || !inTarget || actionLoading}
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
                      text1: "⚠️ Action failed",
                      text2: error.message || "Please try again",
                    });
                  }
                }}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-xl font-bold text-white">
                    {checkin ? "CHECK-OUT" : "CHECK-IN"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {!inTarget && (
          <View className="items-center mt-auto mb-4">
            <Text className="text-xs text-gray-400">
              Swipe Down to Refresh*
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

export default AttendanceAction;

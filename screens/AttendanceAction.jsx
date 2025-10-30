import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from "react-native";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { getPreciseDistance } from "geolib";
import { MaterialCommunityIcons, Entypo } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { selectCheckin, setOnlyCheckIn } from "../redux/Slices/AttendanceSlice";
import { getOfficeLocation, getUserCustomIn } from "../api/userApi";
import { setIsWfh } from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";
import { Retry, WelcomeCard } from "../components/AttendanceAction";
import {
  getPreciseCoordinates,
  useLocationForegroundAccess,
} from "../utils/LocationServices";
import { updateDateTime } from "../utils/TimeServices";
import { hapticsMessage } from "../utils/HapticsMessage";

function AttendanceAction() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const checkin = useSelector(selectCheckin);
  const userDetails = useSelector((state) => state.user.userDetails);
  const employeeCode = userDetails?.employeeCode;

  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(false);
  const [isWFH, setIsWFH] = useState(false);

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

  const {
    data: custom,
    isLoading: customIsLoading,
    isSuccess: customIsSuccess,
    isError: customIsError,
    refetch,
  } = useQuery({
    queryKey: ["custom_in", employeeCode],
    queryFn: () => getUserCustomIn(employeeCode),
  });

  useEffect(() => {
    if (customIsError) {
      hapticsMessage("error");
      Toast.show({
        type: "error",
        text1: "⚠️ Status fetching failed",
        autoHide: true,
        visibilityTime: 3000,
      });
    }

    if (!customIsLoading && customIsSuccess) {
      dispatch(setOnlyCheckIn(custom.custom_in === 1));
      const restrictLocation = custom.custom_restrict_location === 1;
      setIsWFH(!restrictLocation);
      dispatch(setIsWfh(!restrictLocation));

      if (restrictLocation) {
        const checkUserDistanceToOffice = async () => {
          try {
            await useLocationForegroundAccess();
            const userCords = await getPreciseCoordinates();
            const officeLocation = await getOfficeLocation(employeeCode);

            const { latitude, longitude, radius } = officeLocation || {};

            if (!latitude || !longitude) {
              console.warn("⚠️ Office coordinates missing");
              Toast.show({
                type: "info",
                text1: "📍 Reporting location not set",
                text2: "You can check in from anywhere",
              });
              setInTarget(false);
              return;
            }

            const targetLocation = { latitude, longitude };
            const distance = getPreciseDistance(userCords, targetLocation);
            setInTarget(distance <= radius);
          } catch (error) {
            Toast.show({
              type: "error",
              text1: "⚠️ Location check failed",
            });
          }
        };

        checkUserDistanceToOffice();
      }
    }
  }, [custom]);

  useEffect(() => {
    const update = () => setDateTime(updateDateTime());
    update();
    const intervalId = setInterval(update, 9000);
    return () => clearInterval(intervalId);
  }, []);

  return (
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
            refetch().finally(() => setRefresh(false));
          }}
        />
      }
    >
      {customIsError && <Retry retry={refetch} />}

      {customIsLoading && (
        <View className="h-screen absolute bottom-0 w-screen items-center bg-black/50 justify-center z-50">
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
                {customIsLoading ? (
                  <ActivityIndicator size="small" />
                ) : !custom?.custom_reporting_location && !isWFH ? (
                  "Location not set"
                ) : inTarget ? (
                  "Head Office"
                ) : isWFH ? (
                  "in bound"
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

            <TouchableOpacity
              className={`justify-center items-center h-16 mt-4 rounded-2xl ${
                checkin ? "bg-red-600" : "bg-green-600"
              } ${!inTarget && !isWFH ? "opacity-50" : ""}`}
              disabled={!inTarget && !isWFH}
              onPress={() => navigation.navigate("Attendance camera")}
            >
              <Text className="text-xl font-bold text-white">
                {checkin ? "CHECK-OUT" : "CHECK-IN"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {!inTarget && !isWFH && (
        <View className="items-center mt-auto mb-4">
          <Text className="text-xs text-gray-400">Swipe Down to Refresh*</Text>
        </View>
      )}
    </ScrollView>
  );
}

export default AttendanceAction;


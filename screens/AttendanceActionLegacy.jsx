import React, { useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { COLORS, SIZES } from "../constants";
import WelcomeCard from "../components/AttendanceAction/WelcomeCard";
import { SESSION_ORIGIN } from "../utils/attendanceSessionState";
import useAttendanceAction from "../hooks/useAttendanceAction";

/**
 * TEMPORARY — the pre-redesign Attendance Action screen, presentation only.
 *
 * The markup is the original, unchanged; every value and handler now comes from
 * useAttendanceAction() so this and the modern screen share one implementation.
 * Delete alongside the other *Legacy screens when the experiment ends.
 */
function AttendanceActionLegacy() {
  // Asked for when a break is *started* only; ending one stays a single tap.
  const [breakReasonModalVisible, setBreakReasonModalVisible] = useState(false);
  const [breakReasonInput, setBreakReasonInput] = useState("");

  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const {
    checkin,
    sessionOrigin,
    autoActionsEnabled,
    dateTime,
    restrictLocation,
    restrictionLoaded,
    allowCheckoutAnywhere,
    inTarget,
    ready,
    distanceInfo,
    onBreak,
    liveBreakTime,
    breakMinutes,
    breakCompleted,
    monthlyCapMessage,
    actionLoading,
    refresh,
    setRefresh,
    fetchStatusAndLocation,
    handlePrimaryAction,
    handleBreak,
    devBreakMockMode,
    setDevBreakMockMode,
    applyDevBreakPreset,
    handleInvalidateAccessToken,
  } = useAttendanceAction();

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
          {onBreak && (
            <View className="mb-3 rounded-2xl bg-amber-500 px-4 py-1">
              <Text className="text-center text-xs font-semibold tracking-widest text-amber-100">
                BREAK IN PROGRESS
              </Text>
              <Text
                className="mt-1 text-center text-2xl font-extrabold text-white"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {liveBreakTime || "00:00:00"}
              </Text>
              <Text className="mt-1 text-center text-xs text-amber-100">
                Auto-ends at 02:00:00
              </Text>
            </View>
          )}
          <WelcomeCard />
          {checkin && autoActionsEnabled && (
            <View className="mt-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2">
              <Text className="text-center text-xs text-emerald-800">
                {sessionOrigin === SESSION_ORIGIN.AUTO
                  ? "Checked in automatically. You'll be checked out when you leave the office."
                  : "You'll be checked out automatically when you leave the office."}
              </Text>
            </View>
          )}
          {__DEV__ && (
            <View className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3">
              <TouchableOpacity
                className="rounded-2xl bg-red-600 px-4 py-3 items-center"
                onPress={handleInvalidateAccessToken}
              >
                <Text className="text-white font-bold">
                  DEV: Invalidate access token
                </Text>
              </TouchableOpacity>

              <Text className="mt-3 text-xs font-bold uppercase tracking-wide text-red-700">
                DEV: Break UI presets
              </Text>

              <TouchableOpacity
                className={`mt-2 rounded-xl px-3 py-2 ${
                  devBreakMockMode ? "bg-emerald-700" : "bg-slate-700"
                }`}
                onPress={() => setDevBreakMockMode((prev) => !prev)}
              >
                <Text className="text-xs font-semibold text-white">
                  DEV local break flow: {devBreakMockMode ? "ON" : "OFF"}
                </Text>
              </TouchableOpacity>

              <View className="mt-2 flex-row flex-wrap">
                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-slate-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("idle-0")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Idle 00:00
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-slate-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("idle-45")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Idle 00:45
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-amber-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("running-30")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Running +30m
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-gray-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("cap-120")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Cap 02:00
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-indigo-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("completed")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Completed 1/day
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="mb-2 mr-2 rounded-xl bg-rose-700 px-3 py-2"
                  onPress={() => applyDevBreakPreset("monthly-cap")}
                >
                  <Text className="text-xs font-semibold text-white">
                    Monthly Cap 8h
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View className="h-72 mt-4 mb-24">
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
                  {restrictLocation === 0
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
              {restrictLocation === 1 && distanceInfo && (
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
                } ${
                  restrictLocation === 1 && !inTarget && !allowCheckoutAnywhere
                    ? "opacity-50"
                    : ""
                }`}
                disabled={
                  actionLoading ||
                  (restrictLocation === 1 &&
                    !inTarget &&
                    !allowCheckoutAnywhere)
                }
                onPress={handlePrimaryAction}
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
                      actionLoading ||
                      (restrictLocation === 1 && !inTarget) ||
                      breakCompleted ||
                      breakMinutes >= 120
                        ? "bg-gray-400" // ✅ disabled color
                        : onBreak
                          ? "bg-slate-500" // break running
                          : "bg-blue-400" // normal
                    }`}
                    disabled={
                      actionLoading ||
                      (restrictLocation === 1 && !inTarget) ||
                      breakCompleted ||
                      breakMinutes >= 120
                    }
                    onPress={() => {
                      if (onBreak) {
                        handleBreak();
                      } else {
                        setBreakReasonInput("");
                        setBreakReasonModalVisible(true);
                      }
                    }}
                  >
                    <Text className="text-xl font-bold text-white">
                      {actionLoading ||
                      (restrictLocation === 1 && !inTarget) ||
                      breakCompleted ||
                      breakMinutes >= 120
                        ? "BREAK NOT ALLOWED"
                        : onBreak
                          ? "END BREAK"
                          : "TAKE BREAK"}
                    </Text>
                  </TouchableOpacity>

                  {!!monthlyCapMessage && (
                    <View className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2">
                      <Text className="text-xs font-semibold text-rose-700">
                        {monthlyCapMessage}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Break reason — start only, and optional. */}
      <Modal
        visible={breakReasonModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBreakReasonModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 items-center justify-center bg-black/40 px-6">
            <View className="w-full rounded-2xl bg-white p-5">
              <Text className="text-lg font-bold text-gray-900 mb-1">
                Take a break
              </Text>
              <Text className="text-sm text-gray-500 mb-3">
                Add a reason for this break (optional)
              </Text>
              <TextInput
                value={breakReasonInput}
                onChangeText={setBreakReasonInput}
                placeholder="Enter reason"
                placeholderTextColor="#6B7280"
                multiline
                className="border border-gray-300 rounded-lg px-3 py-2 mb-4 text-gray-900"
              />
              <View className="flex-row justify-end">
                <TouchableOpacity
                  className="px-4 py-2 mr-2 rounded-xl"
                  onPress={() => setBreakReasonModalVisible(false)}
                >
                  <Text className="text-base font-semibold text-gray-500">
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="px-4 py-2 rounded-xl bg-blue-400"
                  onPress={() => {
                    setBreakReasonModalVisible(false);
                    handleBreak(breakReasonInput.trim());
                  }}
                >
                  <Text className="text-base font-semibold text-white">
                    Start Break
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

export default AttendanceActionLegacy;

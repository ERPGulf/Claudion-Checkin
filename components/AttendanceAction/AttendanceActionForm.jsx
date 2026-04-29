import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS } from "../../constants";

function AttendanceActionForm({
  dateTime,
  locationStatusText,
  distanceInfo,
  restrictLocation,
  checkin,
  actionLoading,
  isLocationBlocked,
  onCheckInOutPress,
  onBreakPress,
  breakDisabled,
  breakButtonLabel,
  breakButtonToneClass,
  monthlyCapMessage,
}) {
  return (
    <View className="h-72 mt-4 mb-24">
      <View className="p-3">
        <Text className="text-base text-gray-500 font-semibold">
          DATE AND TIME *
        </Text>
        <View className="flex-row items-end border-b border-gray-400 pb-2 mb-6 justify-between">
          <Text className="text-sm font-medium text-gray-500">{dateTime}</Text>
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
            {locationStatusText}
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

        <TouchableOpacity
          className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${
            checkin ? "bg-red-600" : "bg-green-600"
          } ${isLocationBlocked ? "opacity-50" : ""}`}
          disabled={actionLoading || isLocationBlocked}
          onPress={onCheckInOutPress}
        >
          <Text className="text-xl font-bold text-white">
            {checkin ? "CHECK-OUT" : "CHECK-IN"}
          </Text>
        </TouchableOpacity>

        {checkin && (
          <View>
            <TouchableOpacity
              className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${breakButtonToneClass}`}
              disabled={breakDisabled}
              onPress={onBreakPress}
            >
              <Text className="text-xl font-bold text-white">
                {breakButtonLabel}
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
  );
}

export default React.memo(AttendanceActionForm);

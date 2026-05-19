import React from "react";
import { View, Text } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS } from "../../constants";

export default function AttendanceInfo({
  dateTime,
  restrictLocation,
  ready,
  inTarget,
  distanceInfo,
}) {
  return (
    <View>

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
            : inTarget
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
            Distance: {distanceInfo.distance} m |
            Allowed: {distanceInfo.radius} m
          </Text>
        </View>
      )}

    </View>
  );
}
import React from "react";
import {
  TouchableOpacity,
  Text,
} from "react-native";

export default function CheckinButton({
  checkin,
  actionLoading,
  disabled,
  onPress,
}) {
  return (
    <TouchableOpacity
      className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${
        checkin ? "bg-red-600" : "bg-green-600"
      } ${disabled ? "opacity-50" : ""}`}
      disabled={actionLoading || disabled}
      onPress={onPress}
    >
      <Text className="text-xl font-bold text-white">
        {checkin ? "CHECK-OUT" : "CHECK-IN"}
      </Text>
    </TouchableOpacity>
  );
}
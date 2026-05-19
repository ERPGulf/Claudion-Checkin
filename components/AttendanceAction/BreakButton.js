import React from "react";
import {
  View,
  TouchableOpacity,
  Text,
} from "react-native";

export default function BreakButton({
  actionLoading,
  restrictLocation,
  inTarget,
  breakCompleted,
  breakMinutes,
  onBreak,
  onPress,
  monthlyCapMessage,
}) {
  const disabled =
    actionLoading ||
    (restrictLocation === "1" && !inTarget) ||
    breakCompleted ||
    breakMinutes >= 120;

  const buttonText = disabled
    ? "BREAK NOT ALLOWED"
    : onBreak
    ? "END BREAK"
    : "TAKE BREAK";

  const buttonColor = disabled
    ? "bg-gray-400"
    : onBreak
    ? "bg-slate-500"
    : "bg-blue-400";

  return (
    <View>

      <TouchableOpacity
        className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${buttonColor}`}
        disabled={disabled}
        onPress={onPress}
      >
        <Text className="text-xl font-bold text-white">
          {buttonText}
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
  );
}
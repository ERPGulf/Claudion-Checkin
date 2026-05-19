import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

function BreakManagement({
  checkin,
  onBreak,
  liveBreakTime,
  actionLoading,
  restrictLocation,
  inTarget,
  breakCompleted,
  breakMinutes,
  monthlyCapMessage,
  handleBreak,
}) {
  // Hide completely when user is not checked in
  if (!checkin) return null;

  const disabled =
    actionLoading ||
    (restrictLocation === "1" && !inTarget) ||
    breakCompleted ||
    breakMinutes >= 120;

  const buttonBg = disabled
    ? "bg-gray-400"
    : onBreak
      ? "bg-slate-500"
      : "bg-blue-400";

  const buttonText = disabled
    ? "BREAK NOT ALLOWED"
    : onBreak
      ? "END BREAK"
      : "TAKE BREAK";

  return (
    <>
      {/* BREAK TIMER BANNER */}
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

      {/* BREAK BUTTON */}
      <View>
        <TouchableOpacity
          className={`justify-center items-center h-16 w-full mt-4 rounded-2xl ${buttonBg}`}
          disabled={disabled}
          onPress={handleBreak}
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
    </>
  );
}

export default BreakManagement;
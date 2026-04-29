import React from "react";
import { View, Text } from "react-native";

function BreakInProgressBanner({ liveBreakTime }) {
  return (
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
  );
}

export default React.memo(BreakInProgressBanner);

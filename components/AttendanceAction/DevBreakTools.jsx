import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

const PRESETS = [
  { key: "idle-0", label: "Idle 00:00", tone: "bg-slate-700" },
  { key: "idle-45", label: "Idle 00:45", tone: "bg-slate-700" },
  { key: "running-30", label: "Running +30m", tone: "bg-amber-700" },
  { key: "cap-120", label: "Cap 02:00", tone: "bg-gray-700" },
  { key: "completed", label: "Completed 1/day", tone: "bg-indigo-700" },
  { key: "monthly-cap", label: "Monthly Cap 8h", tone: "bg-rose-700" },
];

function DevBreakTools({
  devBreakMockMode,
  onToggleDevBreakMockMode,
  onInvalidateAccessToken,
  onApplyPreset,
}) {
  return (
    <View className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3">
      <TouchableOpacity
        className="rounded-2xl bg-red-600 px-4 py-3 items-center"
        onPress={onInvalidateAccessToken}
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
        onPress={onToggleDevBreakMockMode}
      >
        <Text className="text-xs font-semibold text-white">
          DEV local break flow: {devBreakMockMode ? "ON" : "OFF"}
        </Text>
      </TouchableOpacity>

      <View className="mt-2 flex-row flex-wrap">
        {PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.key}
            className={`mb-2 mr-2 rounded-xl px-3 py-2 ${preset.tone}`}
            onPress={() => onApplyPreset(preset.key)}
          >
            <Text className="text-xs font-semibold text-white">
              {preset.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default React.memo(DevBreakTools);

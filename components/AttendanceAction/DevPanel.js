// components/DevPanel.js

import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

export default function DevPanel({
  devBreakMockMode,
  setDevBreakMockMode,
  applyDevBreakPreset,
  handleInvalidateAccessToken,
}) {
  return (
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
  );
}
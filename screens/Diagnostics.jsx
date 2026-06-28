import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Share,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, BUILD_TAG } from "../constants";
import { getEntries, formatReport, clearEntries } from "../utils/diagnosticLog";

// Standalone log viewer for release/preview APKs. Reachable BEFORE login (from
// the build-tag on the Login / Welcome screens) so a client stuck at login can
// export the captured logs back to support via the native share sheet.
function Diagnostics() {
  const navigation = useNavigation();
  const [entries, setEntries] = useState([]);
  const [header, setHeader] = useState({});

  const buildHeader = useCallback(async () => {
    let baseUrl = null;
    let hasApiKey = false;
    let hasAppKey = false;
    let hasAccessToken = false;
    try {
      const [storedBaseUrl, apiKey, appKey, accessToken] =
        await AsyncStorage.multiGet([
          "baseUrl",
          "api_key",
          "app_key",
          "access_token",
        ]).then((pairs) => pairs.map(([, v]) => v));
      baseUrl = storedBaseUrl;
      hasApiKey = Boolean(apiKey);
      hasAppKey = Boolean(appKey);
      hasAccessToken = Boolean(accessToken);
    } catch {
      // ignore — header is best-effort
    }

    return {
      Build: BUILD_TAG,
      "App version": Constants.expoConfig?.version ?? "—",
      "Runtime version":
        typeof Constants.expoConfig?.runtimeVersion === "string"
          ? Constants.expoConfig.runtimeVersion
          : "—",
      Platform: `${Platform.OS} ${Device.osVersion ?? ""}`.trim(),
      Device: `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim(),
      "Device time": new Date().toString(),
      "Base URL": baseUrl ?? "(not set — QR not scanned)",
      Provisioning: `api_key:${hasApiKey ? "yes" : "NO"} app_key:${
        hasAppKey ? "yes" : "NO"
      }`,
      "Access token": hasAccessToken ? "present" : "none",
    };
  }, []);

  const refresh = useCallback(async () => {
    setEntries(getEntries());
    setHeader(await buildHeader());
  }, [buildHeader]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onShare = useCallback(async () => {
    try {
      const report = formatReport(await buildHeader());
      await Share.share({
        title: "Claudion Check-in diagnostics",
        message: report,
      });
    } catch (error) {
      Alert.alert("Could not share logs", String(error?.message ?? error));
    }
  }, [buildHeader]);

  const onClear = useCallback(() => {
    Alert.alert("Clear logs?", "This removes all captured diagnostic logs.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await clearEntries();
          refresh();
        },
      },
    ]);
  }, [refresh]);

  const levelColor = (level) => {
    if (level === "error") return COLORS.red;
    if (level === "warn") return "#B7791F";
    if (level === "event") return COLORS.primary;
    return COLORS.grayText ?? COLORS.gray2;
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.white }}
      edges={["top", "bottom"]}
    >
      {/* Header bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.borderGray ?? "#E5E7EB",
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ padding: 4, marginRight: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.black }}>
          Diagnostics
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={refresh} style={{ padding: 6 }}>
          <Ionicons name="refresh" size={22} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Device / build summary */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: COLORS.grayBackground ?? "#F3F4F6",
        }}
      >
        {Object.entries(header).map(([key, value]) => (
          <Text
            key={key}
            style={{ fontSize: 11, color: COLORS.grayText ?? COLORS.gray2 }}
          >
            <Text style={{ fontWeight: "700" }}>{key}: </Text>
            {String(value)}
          </Text>
        ))}
      </View>

      {/* Log entries */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
      >
        {entries.length === 0 ? (
          <Text style={{ color: COLORS.gray2, fontSize: 13 }}>
            No logs captured yet. Reproduce the issue (try to log in), then come
            back here and tap Refresh.
          </Text>
        ) : (
          entries.map((e, i) => (
            <Text
              key={`${e.t}-${i}`}
              selectable
              style={{
                fontSize: 11,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                color: levelColor(e.level),
                marginBottom: 6,
              }}
            >
              {`${new Date(e.t).toLocaleTimeString()} ${e.level.toUpperCase()}${
                e.tag ? ` ${e.tag}` : ""
              }\n${e.msg}`}
            </Text>
          ))
        )}
      </ScrollView>

      {/* Actions */}
      <View
        style={{
          flexDirection: "row",
          padding: 12,
          gap: 10,
          borderTopWidth: 1,
          borderTopColor: COLORS.borderGray ?? "#E5E7EB",
        }}
      >
        <TouchableOpacity
          onPress={onClear}
          style={{
            paddingHorizontal: 18,
            height: 50,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.red,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ color: COLORS.red, fontWeight: "600" }}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onShare}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 12,
            backgroundColor: COLORS.primary,
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "row",
          }}
        >
          <Ionicons
            name="share-outline"
            size={20}
            color={COLORS.white}
            style={{ marginRight: 8 }}
          />
          <Text style={{ color: COLORS.white, fontWeight: "700", fontSize: 16 }}>
            Share logs
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default Diagnostics;

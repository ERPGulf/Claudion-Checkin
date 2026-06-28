// components/UpdateBanner.jsx
//
// App-wide OTA update banner. It checks expo-updates on mount and every time the
// app returns to the foreground, downloads any available update in the
// background, and — once the update is downloaded and ready — shows a tappable
// banner so the user can apply it from ANY screen without waiting for a cold
// relaunch. Mounted once at the app root (App.js), above the navigator.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";
import { COLORS } from "../constants";

export default function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdateAvailable, isUpdatePending, isDownloading } =
    Updates.useUpdates();
  const [applying, setApplying] = useState(false);

  // OTA is disabled in Expo Go / dev builds — never check or fetch there.
  const canUpdate = !__DEV__ && Updates.isEnabled;

  // Check on mount and whenever the app comes back to the foreground, so an
  // update published while the app is open is picked up without a relaunch.
  useEffect(() => {
    if (!canUpdate) return undefined;

    const check = () => {
      Updates.checkForUpdateAsync().catch(() => {});
    };

    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, [canUpdate]);

  // When the server has a newer update, download it quietly in the background.
  useEffect(() => {
    if (canUpdate && isUpdateAvailable && !isUpdatePending && !isDownloading) {
      Updates.fetchUpdateAsync().catch(() => {});
    }
  }, [canUpdate, isUpdateAvailable, isUpdatePending, isDownloading]);

  const onApply = useCallback(async () => {
    setApplying(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Reload failed — let the user try again.
      setApplying(false);
    }
  }, []);

  // Only surface the banner once an update is downloaded and ready to apply.
  if (!isUpdatePending) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top + 8,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: COLORS.primary,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 9999,
        elevation: 9999,
      }}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: COLORS.white, fontSize: 15, fontWeight: "700" }}>
          Update available
        </Text>
        <Text style={{ color: COLORS.white, fontSize: 12, opacity: 0.9 }}>
          A new version is ready to install.
        </Text>
      </View>

      <TouchableOpacity
        onPress={onApply}
        disabled={applying}
        style={{
          backgroundColor: COLORS.white,
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 8,
          minWidth: 96,
          alignItems: "center",
        }}
      >
        {applying ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
            Update now
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

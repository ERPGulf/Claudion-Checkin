import { t, useTranslation } from '../localization';
// components/UpdateBanner.jsx
//
// App-wide OTA update banner. It checks expo-updates on mount and every time the
// app returns to the foreground, downloads any available update in the
// background, and — once the update is downloaded and ready — shows a tappable
// banner so the user can apply it from ANY screen without waiting for a cold
// relaunch. Mounted once at the app root (App.js), above the navigator.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator, AppState } from 'react-native';
import Text from '../localization/LocalizedText';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";
import { COLORS } from "../constants";

export default function UpdateBanner() {
  const { language, direction, isRTL } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isUpdatePending, isDownloading } =
    Updates.useUpdates();
  const [applying, setApplying] = useState(false);
  const updateState = useRef({ isUpdatePending, isDownloading });
  updateState.current = { isUpdatePending, isDownloading };

  // OTA is disabled in Expo Go / dev builds — never check or fetch there.
  const canUpdate = !__DEV__ && Updates.isEnabled;

  // Check on mount and whenever the app comes back to the foreground, so an
  // update published while the app is open is picked up without a relaunch.
  useEffect(() => {
    if (!canUpdate) return undefined;
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (cancelled || checking || AppState.currentState !== 'active' ||
          updateState.current.isUpdatePending || updateState.current.isDownloading) return;
      checking = true;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!cancelled && AppState.currentState === 'active' && update.isAvailable &&
            !updateState.current.isUpdatePending && !updateState.current.isDownloading) {
          await Updates.fetchUpdateAsync();
        }
      } catch {
        // A failed check/download waits for a later foreground event. Retrying
        // from isDownloading changes would loop during an update-server outage.
      } finally {
        checking = false;
      }
    };

    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [canUpdate]);

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
      <View style={{ flex: 1, paddingEnd: 12 }}>
        <Text style={{ color: COLORS.white, fontSize: 15, fontWeight: "700" }}>{t("Update available")}</Text>
        <Text style={{ color: COLORS.white, fontSize: 12, opacity: 0.9 }}>{t("A new version is ready to install.")}</Text>
      </View>

      <TouchableOpacity
        onPress={onApply}
        disabled={applying}
        accessibilityRole="button"
        accessibilityState={{ disabled: applying, busy: applying }}
        accessibilityLabel={t("Update now")}
        style={{
          backgroundColor: COLORS.white,
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 8,
          minWidth: 96,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {applying ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Text style={{ color: COLORS.primary, fontWeight: "700" }}>{t("Update now")}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

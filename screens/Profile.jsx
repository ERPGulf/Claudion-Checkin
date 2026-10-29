import Text from '../localization/LocalizedText';
import LanguageSetting from '../components/settings/LanguageSetting';
import { t, useTranslation } from "../localization";
import {
  View,
  Alert,
  Platform,
  ScrollView,
  Share,
} from "react-native";
import { Image } from "expo-image";
import React, { useLayoutEffect, useState, useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSelector } from "react-redux";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import Ionicons from "react-native-vector-icons/Ionicons";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { BRAND_TEAL_MINT, RADIUS, SPACING, TYPO } from "../constants";
import { withAlpha } from "../utils/color";
import useAppTheme from "../hooks/useAppTheme";
import Card from "../components/common/Card";
import SectionHeader from "../components/common/SectionHeader";
import SettingsRow, { RowDivider } from "../components/common/SettingsRow";
import ActionButton from "../components/common/ActionButton";
import AppearanceSetting from "../components/settings/AppearanceSetting";
import OfflineSyncSetting from "../components/settings/OfflineSyncSetting";
import AttendanceRecoverySetting from "../components/settings/AttendanceRecoverySetting";
import AttendanceSyncTestSetting from "../components/settings/AttendanceSyncTestSetting";
import FeatureSettingsStatus from "../components/settings/FeatureSettingsStatus";
import CrashlyticsTestSetting from "../components/settings/CrashlyticsTestSetting";
import LocationOnboardingTestSetting from "../components/settings/LocationOnboardingTestSetting";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import HomeExperienceSetting from "../components/experimental/HomeExperienceSetting";
import user from "../assets/images/user.png";
import { hapticsMessage } from "../utils/HapticsMessage";
import { clearTokens, clearStore } from "../services/api/apiClient";
import { clearOfflineAttendance } from "../services/offline/AttendanceQueueService";
import apiClient from "../services/api/apiClient";
import { clearAuthCache } from "../services/api/authHelper";
import { invalidateAuthSession } from "../utils/authSessionGuard";
import {
  clearFcmRegistration,
  getClientFcmToken,
} from "../services/notifications/fcm.service";
import * as Device from "expo-device";
import { describeRunningUpdate } from "../utils/otaUpdate";

const maskToken = (token) => {
  if (!token) {
    return t("Not generated yet");
  }

  if (token.length <= 20) {
    return token;
  }

  return `${token.slice(0, 12)}...${token.slice(-8)}`;
};

function Profile() {
  const { language } = useTranslation();
  const navigation = useNavigation();
  const bottomTabBarHeight = useBottomTabBarHeight();
  const { colors, isDark } = useAppTheme();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState({ key: "Ready to check for an OTA update.", tone: "info" });
  const [clientToken, setClientToken] = useState(null);
  const [isSharingClientToken, setIsSharingClientToken] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mockToastCount, setMockToastCount] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t("My Profile"),
      headerTitleAlign: "center",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.surfaceSecondary },
      headerTitleStyle: { color: colors.textPrimary },
      headerTintColor: colors.textPrimary,
    });
  }, [navigation, colors.surfaceSecondary, colors.textPrimary, language]);

  const fullname = useSelector((state) => state.user.fullname);
  const appVersion =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  const buildNumber = Constants.nativeBuildVersion ?? "unknown";
  // `||`, not `??`: a dev build reports the channel as "" rather than null, and
  // an empty string rendered an empty pill in the hero.
  const updateChannel = Updates.channel || "none";
  const isProductionChannel = updateChannel === "production";
  // Which JS this device is actually running. The native version above answers
  // which binary is installed, which an OTA does not change — so two devices can
  // both report 1.2.0 (12) and be weeks apart. See utils/otaUpdate.js.
  const runningUpdate = describeRunningUpdate({
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEnabled: Updates.isEnabled,
  });
  const isIosSimulator = Platform.OS === "ios" && !Device.isDevice;
  const tokenDisplayText = isIosSimulator
    ? t("Unavailable on iOS Simulator. Use a physical iPhone to generate an FCM token.")
    : maskToken(clientToken);
  const deviceName = Device.deviceName || Device.modelName || t("Unknown Device");
  const osInfo = `${Device.osName || ""} ${Device.osVersion || ""}`;
  const getStatusTone = () => {
    if (isCheckingUpdate) {
      return {
        backgroundColor: colors.accentSurface,
        borderColor: colors.accentBorder,
        icon: "sync-outline",
        iconColor: colors.accentText,
      };
    }

    if (updateStatus.tone === "neutral") {
      return {
        backgroundColor: colors.iconBackground,
        borderColor: colors.cardBorder,
        icon: "checkmark-circle-outline",
        iconColor: colors.textSecondary,
      };
    }

    if (updateStatus.tone === "error") {
      return {
        backgroundColor: colors.errorSurface,
        borderColor: colors.errorBorder,
        icon: "alert-circle-outline",
        iconColor: colors.errorText,
      };
    }

    if (updateStatus.tone === "success") {
      return {
        backgroundColor: colors.successSurface,
        borderColor: colors.successBorder,
        icon: "cloud-download-outline",
        iconColor: colors.successText,
      };
    }

    return {
      backgroundColor: colors.infoSurface,
      borderColor: colors.infoBorder,
      icon: "information-circle-outline",
      iconColor: colors.infoText,
    };
  };

  const statusTone = getStatusTone();

  useEffect(() => {
    let isMounted = true;

    const loadClientToken = async () => {
      if (isIosSimulator) {
        if (isMounted) {
          setClientToken(null);
        }
        return;
      }

      const token = await getClientFcmToken();

      if (!isMounted) {
        return;
      }

      setClientToken(token);
    };

    loadClientToken();

    return () => {
      isMounted = false;
    };
  }, [isIosSimulator]);

  const handleShareClientToken = async () => {
    if (isIosSimulator) {
      Toast.show({
        type: "info",
        text1: t("FCM token unavailable on Simulator"),
        text2:
          t("Run this build on a physical iPhone to generate and share the client token."),
        visibilityTime: 4200,
        autoHide: true,
      });
      return;
    }

    setIsSharingClientToken(true);

    try {
      const token = await getClientFcmToken();

      if (!token) {
        Toast.show({
          type: "error",
          text1: t("Client token unavailable"),
          text2: t("Enable notification permission and try again."),
          visibilityTime: 3500,
          autoHide: true,
        });
        return;
      }

      setClientToken(token);

      await Share.share({
        title: t("FCM Client Token"),
        message: t("FCM client token ({{platform}}):\n{{token}}", { platform: Platform.OS, token }),
      });
    } catch {
      Toast.show({
        type: "error",
        text1: t("Unable to share token"),
        visibilityTime: 3000,
        autoHide: true,
      });
    } finally {
      setIsSharingClientToken(false);
    }
  };

  const handleMockForegroundToast = () => {
    if (!__DEV__) {
      return;
    }

    const isAnnouncement = mockToastCount % 2 === 1;
    const toastType = isAnnouncement
      ? "announcementToast"
      : "notificationToast";

    Toast.show({
      type: toastType,
      text1: isAnnouncement ? t("Mock announcement") : t("Mock notification"),
      text2: isAnnouncement
        ? t("Dev-only toast test for announcement payload style.")
        : t("Dev-only toast test for notification payload style."),
      visibilityTime: 3500,
      autoHide: true,
      onPress: () => {
        Toast.hide();
        navigation.navigate("Notifications");
      },
    });

    setMockToastCount((prev) => prev + 1);
  };

  const handleCheckForUpdates = async () => {
    if (__DEV__ || !Updates.isEnabled) {
      const message =
        "Install an EAS build to test OTA updates. Expo Go does not use your EAS update channel.";

      setUpdateStatus({ key: message, tone: "info" });
      Toast.show({
        type: "info",
        text1: t("OTA check unavailable"),
        text2: t(message),
        visibilityTime: 4000,
        autoHide: true,
      });
      return;
    }

    try {
      setIsCheckingUpdate(true);
      setUpdateStatus({ key: "Checking {{channel}} for a new update...", values: { channel: updateChannel }, tone: "info" });

      const update = await Updates.checkForUpdateAsync();

      if (!update.isAvailable) {
        setUpdateStatus({ key: "No OTA update available on {{channel}}.", values: { channel: updateChannel }, tone: "neutral" });
        Toast.show({
          type: "info",
          text1: t("No update available"),
          text2: t("Channel: {{channel}}", { channel: updateChannel }),
          visibilityTime: 3000,
          autoHide: true,
        });
        return;
      }

      setUpdateStatus({ key: "Update found. Downloading now...", tone: "success" });
      await Updates.fetchUpdateAsync();

      Toast.show({
        type: "success",
        text1: t("Update downloaded"),
        text2: t("The app will reload to apply it."),
        visibilityTime: 2500,
        autoHide: true,
      });

      setUpdateStatus({ key: "Update downloaded. Reloading app...", tone: "success" });
      await Updates.reloadAsync();
    } catch (error) {
      const message = "Unable to check for OTA updates.";

      setUpdateStatus({ key: message, tone: "error" });
      Toast.show({
        type: "error",
        text1: t("OTA check failed"),
        text2: t(message),
        visibilityTime: 4000,
        autoHide: true,
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleLogout = async () => {
    // The confirmation dialog can be dismissed and reopened faster than the
    // teardown runs, and two overlapping logouts race each other's storage
    // writes for no benefit.
    if (isSigningOut) return;
    setIsSigningOut(true);
    invalidateAuthSession();

    try {
      hapticsMessage("success");

      // 1. Remove FCM registration to avoid cross-user push delivery.
      await clearFcmRegistration();

      // 1b. Drop the cached attendance rules for the same reason: they are the
      // previous employee's reporting locations and policy flags, and would
      // otherwise govern the next one's offline check-ins.
      //
      // Queued punches are deliberately KEPT. They are payroll data the employee
      // has already earned, and logging out is not a decision to discard it —
      // the drain is scoped to the authenticated employee, so nobody else's
      // token can upload them.
      await clearOfflineAttendance();

      // 2. Clear tokens from storage
      await clearTokens();

      // 3. Clear cached auth data
      clearAuthCache();

      // 4. Clear redux store
      clearStore();

      // 5. Remove axios authorization header
      delete apiClient.defaults.headers.common.Authorization;
    } catch (error) {
      hapticsMessage("error");
      Toast.show({
        type: "error",
        text1: t("Logout failed"),
        autoHide: true,
        visibilityTime: 3000,
      });
      // Only on failure. On success `clearStore()` has already swapped the
      // navigator, so this component is unmounted and setting state on it would
      // be a no-op at best.
      setIsSigningOut(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: bottomTabBarHeight + SPACING.xxxl,
        }}
      >
        {/* -------------------- IDENTITY -------------------- */}
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: RADIUS.xl,
            padding: SPACING.lg,
            // Already a dark surface, so it stays put in both palettes — it
            // just needs an edge once the page behind it goes dark too.
            ...(isDark
              ? { borderWidth: 1, borderColor: colors.cardBorder }
              : null),
          }}
        >
          {/* Decorative glow, tangent to the card edges rather than bleeding
              past them, so the card needs no `overflow: 'hidden'`. That
              matters: with it, Android clipped away *every* child and rendered
              the hero as an empty black block, and Android clips to the
              bounding rect rather than the rounded corner anyway, which squares
              off the corners. A circle tangent to two edges stays ~25pt clear
              of a 20pt corner arc, so there is nothing left to clip. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              end: 0,
              width: 132,
              height: 132,
              borderRadius: 66,
              // Wider and fainter than the old bleeding circle: without a hard
              // edge cutting it off, a small opaque disc reads as a stray blob,
              // where a large soft one reads as ambient light.
              // The mint end explicitly, not `colors.primary2`: this card is
              // `colors.primary` in both palettes, so in light mode the accent
              // token is the deep ink and would vanish against it.
              backgroundColor: withAlpha(BRAND_TEAL_MINT, 0.11),
            }}
          />

          <View className="flex-row items-center justify-between">
            <View
              style={{
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.xs + 2,
                borderRadius: RADIUS.pill,
                backgroundColor: withAlpha(BRAND_TEAL_MINT, 0.14),
              }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: BRAND_TEAL_MINT }}
              >
                {isProductionChannel ? t("Production") : updateChannel}
              </Text>
            </View>

            <View className="flex-row items-center">
              <Ionicons
                name="shield-checkmark-outline"
                size={16}
                color="#F2F4F7"
              />
              <Text className="text-sm font-medium text-gray-200" style={{ marginStart: 4 }}>{t("Secure account")}</Text>
            </View>
          </View>

          <View className="mt-5 flex-row items-center">
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: RADIUS.xl,
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                borderWidth: 1,
                borderColor: "rgba(255, 255, 255, 0.15)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                cachePolicy="memory-disk"
                source={user}
                style={{ width: 56, height: 56, borderRadius: RADIUS.lg }}
              />
            </View>

            <View style={{ flex: 1, marginStart: SPACING.lg }}>
              <Text
                numberOfLines={2}
                style={{ ...TYPO.title2, color: colors.white }}
              >
                {fullname}
              </Text>
              <Text
                style={{
                  ...TYPO.subhead,
                  color: "rgba(255, 255, 255, 0.7)",
                  marginTop: 2,
                }}
              >{t("Employee account")}</Text>
            </View>
          </View>
        </View>

        {/* -------------------- BUILD -------------------- */}
        <SectionHeader title={t("This device")} style={{ marginTop: SPACING.xxl }} />

        <Card>
          <SettingsRow
            icon="pricetag-outline"
            title={t("Version")}
            value={`${appVersion} (${buildNumber})`}
          />
          <RowDivider />
          <SettingsRow
            icon="phone-portrait-outline"
            title={t("Device")}
            value={deviceName}
          />
          <RowDivider />
          <SettingsRow
            icon="hardware-chip-outline"
            title={t("System")}
            value={osInfo}
          />
        </Card>

        {/* -------------------- OTA -------------------- */}
        <SectionHeader
          title={t("Over-the-air updates")}
          style={{ marginTop: SPACING.xxl }}
        />

        <Card>
          {/* What is running, before what could be. Someone diagnosing "have you
              got the fix?" needs this row, and until now the screen computed it
              and rendered nothing. */}
          <SettingsRow
            icon="cloud-download-outline"
            title={t("Running")}
            value={runningUpdate.label}
            description={runningUpdate.detail}
          />
          <RowDivider />
          <SettingsRow
            icon="git-branch-outline"
            title={t("Runtime version")}
            value={runningUpdate.runtimeVersion}
            description={t("Which builds this update can reach")}
          />
          <RowDivider />
          <SettingsRow
            icon={statusTone.icon}
            iconTint={statusTone.backgroundColor}
            iconColor={statusTone.iconColor}
            title={t("Update status")}
            description={t(updateStatus.key, updateStatus.values)}
          />

          <View
            style={{
              paddingHorizontal: SPACING.lg,
              paddingBottom: SPACING.lg,
            }}
          >
            <ActionButton
              icon={isCheckingUpdate ? "sync-outline" : "refresh-outline"}
              label={
                isCheckingUpdate ? t("Checking for update") : t("Check for OTA update")
              }
              onPress={handleCheckForUpdates}
              disabled={isCheckingUpdate}
            />
          </View>
        </Card>

        <LanguageSetting />
        <AppearanceSetting />

        <OfflineSyncSetting />
        <AttendanceRecoverySetting />
        <AttendanceSyncTestSetting />
        {/* Renders nothing outside development and preview builds. */}
        <LocationOnboardingTestSetting />

        {/* Renders nothing unless the feature-settings fetch has failed. */}
        <FeatureSettingsStatus />

        {/* TEMPORARY: New Home Experience experiment — delete this line and
            its import when the experiment ends. */}
        <HomeExperienceSetting />

        {/* Renders nothing outside development and preview builds. */}
        <CrashlyticsTestSetting />

        {/* -------------------- SESSION -------------------- */}
        <SectionHeader
          title={t("Session")}
          subtitle={t("Manage your authenticated session and sign out securely from this device.")}
          style={{ marginTop: SPACING.xxl }}
        />

        <Card>
          <SettingsRow
            icon="notifications-outline"
            iconTint={colors.infoSurface}
            iconColor={colors.infoText}
            title={t("Client token")}
            description={tokenDisplayText}
          />

          <View
            style={{
              paddingHorizontal: SPACING.lg,
              paddingBottom: SPACING.lg,
            }}
          >
            <ActionButton
              icon="share-social-outline"
              label={
                isSharingClientToken ? t("Preparing token") : t("Share client token")
              }
              onPress={handleShareClientToken}
              disabled={isSharingClientToken}
            />

            {__DEV__ && (
              <ActionButton
                variant="tinted"
                tone="warning"
                icon="flask-outline"
                label={
                  mockToastCount % 2 === 0
                    ? t("Test notification toast")
                    : t("Test announcement toast")
                }
                onPress={handleMockForegroundToast}
                style={{ marginTop: SPACING.md }}
              />
            )}
          </View>

          <RowDivider />

          <SettingsRow
            icon={isSigningOut ? "sync-outline" : "log-out-outline"}
            iconTint={colors.errorSurface}
            iconColor={colors.errorText}
            title={isSigningOut ? t("Signing out") : t("Sign out")}
            titleColor={colors.errorText}
            description={
              isSigningOut
                ? t("Clearing this session…")
                : t("Clear local data and end this session")
            }
            disabled={isSigningOut}
            onPress={() => {
              Alert.alert(t("Logout"), t("Are you sure you want to logout?"), [
                {
                  text: t("Cancel"),
                  onPress: () => {
                    hapticsMessage("warning");
                    Toast.show({
                      type: "info",
                      text1: t("Logout cancelled"),
                      visibilityTime: 3000,
                      autoHide: true,
                    });
                  },
                  style: "cancel",
                },
                {
                  text: t("Logout"),
                  onPress: handleLogout,
                  style: "destructive",
                },
              ]);
            }}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

export default Profile;

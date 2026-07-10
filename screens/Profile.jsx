import {
  View,
  Text,
  TouchableOpacity,
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
import { COLORS, SIZES } from "../constants";
import user from "../assets/images/user.png";
import { hapticsMessage } from "../utils/HapticsMessage";
import { clearTokens, clearStore } from "../services/api/apiClient";
import apiClient from "../services/api/apiClient";
import { clearAuthCache } from "../services/api/authHelper";
import {
  clearFcmRegistration,
  getClientFcmToken,
} from "../services/notifications/fcm.service";
import * as Device from "expo-device";

const maskToken = (token) => {
  if (!token) {
    return "Not generated yet";
  }

  if (token.length <= 20) {
    return token;
  }

  return `${token.slice(0, 12)}...${token.slice(-8)}`;
};

const formatUpdateId = (updateId) => {
  if (!updateId) {
    return "embedded";
  }

  return `${updateId.slice(0, 8)}...`;
};

function Profile() {
  const navigation = useNavigation();
  const bottomTabBarHeight = useBottomTabBarHeight();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(
    "Ready to check for an OTA update.",
  );
  const [clientToken, setClientToken] = useState(null);
  const [isSharingClientToken, setIsSharingClientToken] = useState(false);
  const [mockToastCount, setMockToastCount] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: "My Profile",
      headerTitleAlign: "center",
      headerShadowVisible: false,
    });
  }, []);

  const fullname = useSelector((state) => state.user.fullname);
  const appVersion =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  const buildNumber = Constants.nativeBuildVersion ?? "unknown";
  const updateChannel = Updates.channel ?? "none";
  const runtimeVersion = Updates.runtimeVersion ?? "unknown";
  const updateId = formatUpdateId(Updates.updateId);
  const isProductionChannel = updateChannel === "production";
  const isIosSimulator = Platform.OS === "ios" && !Device.isDevice;
  const tokenDisplayText = isIosSimulator
    ? "Unavailable on iOS Simulator. Use a physical iPhone to generate an FCM token."
    : maskToken(clientToken);
  const deviceName = Device.deviceName || Device.modelName || "Unknown Device";
  const osInfo = `${Device.osName || ""} ${Device.osVersion || ""}`;
  const getStatusTone = () => {
    if (isCheckingUpdate) {
      return {
        backgroundColor: "#FFF4EA",
        borderColor: "#F87627",
        icon: "sync-outline",
        iconColor: COLORS.primary2,
      };
    }

    if (updateStatus.includes("No OTA update available")) {
      return {
        backgroundColor: "#F4F6F8",
        borderColor: "#DADFE5",
        icon: "checkmark-circle-outline",
        iconColor: "#4B5563",
      };
    }

    if (updateStatus.includes("failed") || updateStatus.includes("Unable")) {
      return {
        backgroundColor: "#FFF1F2",
        borderColor: "#FECDD3",
        icon: "alert-circle-outline",
        iconColor: COLORS.red,
      };
    }

    if (updateStatus.includes("Reloading") || updateStatus.includes("found")) {
      return {
        backgroundColor: "#EFFAF3",
        borderColor: "#B7E4C7",
        icon: "cloud-download-outline",
        iconColor: "#15803D",
      };
    }

    return {
      backgroundColor: "#EEF4FF",
      borderColor: "#CADBFF",
      icon: "information-circle-outline",
      iconColor: "#2457D6",
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
        text1: "FCM token unavailable on Simulator",
        text2:
          "Run this build on a physical iPhone to generate and share the client token.",
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
          text1: "Client token unavailable",
          text2: "Enable notification permission and try again.",
          visibilityTime: 3500,
          autoHide: true,
        });
        return;
      }

      setClientToken(token);

      await Share.share({
        title: "FCM Client Token",
        message: `FCM client token (${Platform.OS}):\n${token}`,
      });
    } catch {
      Toast.show({
        type: "error",
        text1: "Unable to share token",
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
      text1: isAnnouncement ? "Mock announcement" : "Mock notification",
      text2: isAnnouncement
        ? "Dev-only toast test for announcement payload style."
        : "Dev-only toast test for notification payload style.",
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

      setUpdateStatus(message);
      Toast.show({
        type: "info",
        text1: "OTA check unavailable",
        text2: message,
        visibilityTime: 4000,
        autoHide: true,
      });
      return;
    }

    try {
      setIsCheckingUpdate(true);
      setUpdateStatus(`Checking ${updateChannel} for a new update...`);

      const update = await Updates.checkForUpdateAsync();

      if (!update.isAvailable) {
        setUpdateStatus(`No OTA update available on ${updateChannel}.`);
        Toast.show({
          type: "info",
          text1: "No update available",
          text2: `Channel: ${updateChannel}`,
          visibilityTime: 3000,
          autoHide: true,
        });
        return;
      }

      setUpdateStatus("Update found. Downloading now...");
      await Updates.fetchUpdateAsync();

      Toast.show({
        type: "success",
        text1: "Update downloaded",
        text2: "The app will reload to apply it.",
        visibilityTime: 2500,
        autoHide: true,
      });

      setUpdateStatus("Update downloaded. Reloading app...");
      await Updates.reloadAsync();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to check for OTA updates.";

      setUpdateStatus(message);
      Toast.show({
        type: "error",
        text1: "OTA check failed",
        text2: message,
        visibilityTime: 4000,
        autoHide: true,
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleLogout = async () => {
    try {
      hapticsMessage("success");

      // 1. Remove FCM registration to avoid cross-user push delivery.
      await clearFcmRegistration();

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
        text1: "Logout failed",
        autoHide: true,
        visibilityTime: 3000,
      });
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.offwhite,
      }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: bottomTabBarHeight + 32,
        }}
      >
        <View style={{ paddingHorizontal: 16 }}>
          <View
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 28,
              padding: 20,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                position: "absolute",
                top: -24,
                right: -10,
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: "rgba(248, 118, 39, 0.16)",
              }}
            />
            <View
              style={{
                position: "absolute",
                bottom: -32,
                left: -18,
                width: 110,
                height: 110,
                borderRadius: 55,
                backgroundColor: "rgba(255, 255, 255, 0.06)",
              }}
            />

            <View className="flex-row items-center justify-between">
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: "rgba(248, 118, 39, 0.14)",
                }}
              >
                <Text className="text-xs font-semibold uppercase tracking-widest text-orange-300">
                  {isProductionChannel ? "Production" : updateChannel}
                </Text>
              </View>

              <View className="flex-row items-center">
                <Ionicons
                  name="shield-checkmark-outline"
                  size={16}
                  color="#F2F4F7"
                />
                <Text className="ml-1 text-sm font-medium text-gray-200">
                  Secure account
                </Text>
              </View>
            </View>

            <View className="mt-5 flex-row items-center">
              <View
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 28,
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
                  style={{ width: 70, height: 70, borderRadius: 24 }}
                />
              </View>

              <View className="ml-4 flex-1">
                <Text className="text-2xl font-semibold text-white">
                  {fullname}
                </Text>
                <Text className="mt-1 text-sm font-medium text-gray-300">
                  Employee account
                </Text>
                <Text className="mt-3 text-sm font-medium text-gray-200">
                  Version {appVersion}-Jul-10
                </Text>

                <Text className="text-sm text-gray-300 mt-1">{deviceName}</Text>

                <Text className="text-xs text-gray-400">{osInfo}</Text>
              </View>
            </View>
          </View>

          <View
            style={{
              marginTop: 18,
              borderRadius: 24,
              backgroundColor: COLORS.white,
              padding: 18,
              ...(Platform.OS === "ios"
                ? {
                    shadowColor: "#111827",
                    shadowOffset: { width: 0, height: 10 },
                    shadowOpacity: 0.08,
                    shadowRadius: 18,
                  }
                : {
                    elevation: 4,
                  }),
            }}
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-xl font-semibold text-black">
                  Over-the-air updates
                </Text>
              </View>

              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  backgroundColor: "#FFF4EA",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={24}
                  color={COLORS.primary2}
                />
              </View>
            </View>

            <View
              style={{
                marginTop: 16,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: statusTone.borderColor,
                backgroundColor: statusTone.backgroundColor,
                padding: 14,
              }}
            >
              <View className="flex-row items-start">
                <Ionicons
                  name={statusTone.icon}
                  size={20}
                  color={statusTone.iconColor}
                  style={{ marginTop: 1 }}
                />
                <Text className="ml-3 flex-1 text-sm leading-5 text-slate-700">
                  {updateStatus}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleCheckForUpdates}
              disabled={isCheckingUpdate}
              activeOpacity={0.9}
              style={{
                marginTop: 18,
                height: 54,
                borderRadius: 18,
                backgroundColor: isCheckingUpdate
                  ? COLORS.gray2
                  : COLORS.primary,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={isCheckingUpdate ? "sync-outline" : "refresh-outline"}
                size={18}
                color={COLORS.white}
              />
              <Text className="ml-2 text-base font-semibold text-white">
                {isCheckingUpdate
                  ? "Checking for update"
                  : "Check for OTA update"}
              </Text>
            </TouchableOpacity>
          </View>

          <View
            style={{
              marginTop: 18,
              borderRadius: 24,
              backgroundColor: COLORS.white,
              padding: 18,
              ...(Platform.OS === "ios"
                ? {
                    shadowColor: "#111827",
                    shadowOffset: { width: 0, height: 10 },
                    shadowOpacity: 0.08,
                    shadowRadius: 18,
                  }
                : {
                    elevation: 4,
                  }),
            }}
          >
            <Text className="text-xl font-semibold text-black">Session</Text>
            <Text className="mt-2 text-sm leading-5 text-gray-500">
              Manage your authenticated session and sign out securely from this
              device.
            </Text>

            <View
              style={{
                marginTop: 16,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "#D8E5FF",
                backgroundColor: "#F5F9FF",
                padding: 14,
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-slate-900">
                  Client token
                </Text>
                <Ionicons
                  name="notifications-outline"
                  size={18}
                  color="#2457D6"
                />
              </View>

              <Text className="mt-2 text-xs leading-5 text-slate-600">
                {tokenDisplayText}
              </Text>

              <TouchableOpacity
                onPress={handleShareClientToken}
                disabled={isSharingClientToken}
                activeOpacity={0.9}
                style={{
                  marginTop: 12,
                  borderRadius: 14,
                  backgroundColor: isSharingClientToken
                    ? COLORS.gray2
                    : COLORS.primary,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 10,
                }}
              >
                <Ionicons
                  name="share-social-outline"
                  size={16}
                  color={COLORS.white}
                />
                <Text className="ml-2 text-sm font-semibold text-white">
                  {isSharingClientToken
                    ? "Preparing token"
                    : "Share client token"}
                </Text>
              </TouchableOpacity>

              {__DEV__ && (
                <TouchableOpacity
                  onPress={handleMockForegroundToast}
                  activeOpacity={0.9}
                  style={{
                    marginTop: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#F59E0B",
                    backgroundColor: "#FFFBEB",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: 10,
                  }}
                >
                  <Ionicons name="flask-outline" size={16} color="#B45309" />
                  <Text className="ml-2 text-sm font-semibold text-amber-700">
                    {mockToastCount % 2 === 0
                      ? "Test notification toast"
                      : "Test announcement toast"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              onPress={() => {
                Alert.alert("Logout", "Are you sure you want to logout?", [
                  {
                    text: "Cancel",
                    onPress: () => {
                      hapticsMessage("warning");
                      Toast.show({
                        type: "info",
                        text1: "Logout cancelled",
                        visibilityTime: 3000,
                        autoHide: true,
                      });
                    },
                    style: "cancel",
                  },
                  {
                    text: "Logout",
                    onPress: handleLogout,
                    style: "destructive",
                  },
                ]);
              }}
              activeOpacity={0.9}
              style={{
                marginTop: 16,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: "#F3D8DD",
                backgroundColor: "#FFFBFB",
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View className="flex-row items-center flex-1 pr-3">
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 16,
                    backgroundColor: "#FFF0F1",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="log-out-outline"
                    color={COLORS.red}
                    size={22}
                  />
                </View>

                <View className="ml-3">
                  <Text className="text-base font-semibold text-slate-900">
                    Sign out
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-slate-500">
                    Clear local data and end this session
                  </Text>
                </View>
              </View>

              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: "#FFF0F1",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="chevron-forward" size={18} color={COLORS.red} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export default Profile;

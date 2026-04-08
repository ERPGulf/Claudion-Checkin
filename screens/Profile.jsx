import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import { Image } from "expo-image";
import React, { useLayoutEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
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

const formatUpdateId = (updateId) => {
  if (!updateId) {
    return "embedded";
  }

  return `${updateId.slice(0, 8)}...`;
};

function Profile() {
  const navigation = useNavigation();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(
    "Ready to check for an OTA update.",
  );

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

      // 1. Clear tokens from storage
      await clearTokens();

      // 2. Clear cached auth data
      clearAuthCache();

      // 3. Clear redux store
      clearStore();

      // 4. Remove axios authorization header
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
        flexGrow: 1,
        alignItems: "center",
        backgroundColor: "white",
      }}
    >
      <View
        style={{
          width: SIZES.width,
          paddingHorizontal: 12,
          paddingVertical: 16,
          alignItems: "center",
        }}
      >
        <View
          style={{ backgroundColor: COLORS.primary }}
          className="flex-row w-full h-32 rounded-2xl p-3 items-center"
        >
          {/* Profile Icon */}
          <Image
            cachePolicy="memory-disk"
            source={user}
            style={{ width: 75, height: 75 }}
          />

          {/* Name, Employee & Version */}
          <View className="ml-3 justify-center">
            <Text className="text-xl font-semibold text-white">{fullname}</Text>
            <Text className="text-base font-normal text-gray-300">
              Employee
            </Text>

            {/* Version row inside same card */}
            <View className="flex-row items-center mt-1">
              <Text className="text-sm font-normal text-gray-300 ">
                Version
              </Text>
              <Text className="ml-1 text-sm font-semibold text-white">
                {appVersion} ({buildNumber})
              </Text>
            </View>
          </View>
        </View>

        <View
          className={`w-full rounded-xl bg-white mt-4 p-4 ${
            Platform.OS === "ios"
              ? "shadow-sm shadow-black/10"
              : "shadow-sm shadow-black"
          }`}
        >
          <Text className="text-lg font-semibold text-black">OTA Updates</Text>
          <Text className="mt-2 text-sm text-gray-500">
            Channel: {updateChannel}
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            Runtime: {runtimeVersion}
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            Update ID: {updateId}
          </Text>
          <Text className="mt-3 text-sm text-gray-500">{updateStatus}</Text>

          <TouchableOpacity
            onPress={handleCheckForUpdates}
            disabled={isCheckingUpdate}
            className="mt-4 h-12 rounded-xl items-center justify-center"
            style={{
              backgroundColor: isCheckingUpdate ? COLORS.gray2 : COLORS.primary,
            }}
          >
            <Text className="text-base font-semibold text-white">
              {isCheckingUpdate ? "Checking..." : "Check for OTA update"}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => {
            Alert.alert("Logout out", "Are you sure you want to logout", [
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
                text: "OK",
                onPress: handleLogout,
              },
            ]);
          }}
          className={`flex-row h-16 w-full items-center rounded-xl px-3 justify-between bg-white mt-4 ${
            Platform.OS === "ios"
              ? "shadow-sm shadow-black/10"
              : "shadow-sm shadow-black"
          }`}
        >
          <View className="flex-row items-center">
            <Ionicons name="log-out" color="red" size={34} />
            <Text className="ml-2 text-lg font-semibold text-red-500">
              LOGOUT
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={30} color="red" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default Profile;

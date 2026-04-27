import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import { Image } from "expo-image";
import React, { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import Ionicons from "react-native-vector-icons/Ionicons";
import { revertAll } from "../redux/CommonActions";
import { COLORS, SIZES } from "../constants";
import user from "../assets/images/user.png";
import { hapticsMessage } from "../utils/HapticsMessage";
import { selectUserDetails } from "../redux/Slices/UserSlice";
import { clearTokens, clearStore } from "../services/api/apiClient";
import apiClient from "../services/api/apiClient";
import { clearAuthCache } from "../services/api/authHelper";
import * as Device from "expo-device";

const VERSION_CODE = "1.1.2";
function Profile() {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: "My Profile",
      headerTitleAlign: "center",
      headerShadowVisible: false,
    });
  }, []);
  const fullname = useSelector((state) => state.user.fullname);
  const deviceName = Device.deviceName;
  const osName = Device.osName;
  const osVersion = Device.osVersion;
  const modelName = Device.modelName;
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
              <Text className="text-sm font-semibold text-white">
                {VERSION_CODE}
              </Text>
              <Text className="text-sm text-gray-300">
                {deviceName || modelName}
              </Text>
              <Text className="text-sm text-gray-300">
                {osName} {osVersion}
              </Text>
            </View>
          </View>
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

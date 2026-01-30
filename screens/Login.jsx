import React, { useState } from "react";
import { getNotifications } from "../services/api/notification.service";
import { setUnreadCount } from "../redux/Slices/notificationSlice";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { Formik } from "formik";
import * as Yup from "yup";
import { useNavigation } from "@react-navigation/native";
import { setSignIn } from "../redux/Slices/AuthSlice";
import { COLORS, SIZES } from "../constants";
import { WelcomeCard } from "../components/Login";
import { selectEmployeeCode, selectName } from "../redux/Slices/UserSlice";
import { generateToken } from "../services/api";

function Login() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const employeeCode = useSelector(selectEmployeeCode);
  const fullName = useSelector(selectName);

  // Form validation schema
  const loginSchema = Yup.object().shape({
    password: Yup.string()
      .min(5, "Too short!")
      .max(24, "Too long!")
      .required("Please enter your password."),
  });

  // Handle login
  const handleLogin = async (password) => {
    setIsLoading(true);
    try {
      const api_key = await AsyncStorage.getItem("api_key");
      const app_key = await AsyncStorage.getItem("app_key");
      const baseUrl = await AsyncStorage.getItem("baseUrl");

      if (!api_key || !app_key || !baseUrl) {
        Toast.show({
          type: "error",
          text1: "QR code not scanned",
          text2: "Please scan QR code first",
          autoHide: true,
          visibilityTime: 3000,
        });
        setIsLoading(false);
        return;
      }

      const { access_token, refresh_token } = await generateToken({
        api_key,
        app_key,
        api_secret: password,
      });

      if (!access_token) throw new Error("Token not returned from server");

      await AsyncStorage.setItem("access_token", access_token);

      if (employeeCode) {
        await AsyncStorage.setItem("employee_id", employeeCode);
      }

      if (refresh_token) {
        await AsyncStorage.setItem("refresh_token", refresh_token);
      }

      dispatch(setSignIn({ isLoggedIn: true, access_token }));

      // 🔔 NEW: fetch notifications at login
      try {
        const employeeId = await AsyncStorage.getItem("employee_id");

        if (employeeId) {
          const notifications = await getNotifications(employeeId);

          const unreadCount = notifications.filter(
            (item) => Number(item.read) === 0,
          ).length;
          console.log("🔔 Setting unread count:", unreadCount);

          dispatch(setUnreadCount(unreadCount));
        }
      } catch (err) {
        console.log("Notification fetch at login failed:", err);
        // ❌ Do NOT block login if this fails
      }
      Toast.show({
        type: "success",
        text1: "Login successful",
        autoHide: true,
        visibilityTime: 3000,
      });

      // navigation.navigate("homeTab");
    } catch (error) {
      console.log("Login error:", error);
      Toast.show({
        type: "error",
        text1: "Login failed",
        text2:
          error.response?.data?.message ||
          error.message ||
          "Something went wrong",
        autoHide: true,
        visibilityTime: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{
        flex: 1,
        paddingTop: Constants.statusBarHeight,
        backgroundColor: COLORS.grayBackground,
        paddingHorizontal: 12,
      }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <WelcomeCard />

      <Formik
        initialValues={{ password: "" }}
        validationSchema={loginSchema}
        onSubmit={({ password }) => handleLogin(password)}
      >
        {({
          values,
          errors,
          touched,
          handleChange,
          handleSubmit,
          setFieldTouched,
          isValid,
        }) => (
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            {/* Top Section */}
            <View style={{ marginTop: 20 }}>
              <Text
                style={{
                  color: COLORS.grayText,
                  fontSize: 16,
                  marginBottom: 5,
                }}
              >
                Password
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: COLORS.white,
                  borderWidth: 1,
                  borderColor: COLORS.borderGray,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  height: 56,
                  marginBottom: 10,
                }}
              >
                <TextInput
                  secureTextEntry={!showPassword}
                  value={values.password}
                  onChangeText={handleChange("password")}
                  placeholder="Enter password"
                  placeholderTextColor={COLORS.gray2}
                  onBlur={() => setFieldTouched("password")}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    height: "100%",
                    color: COLORS.black,
                  }}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                >
                  <Ionicons
                    name={showPassword ? "eye" : "eye-off"}
                    size={SIZES.xLarge}
                    color={COLORS.gray2}
                  />
                </TouchableOpacity>
              </View>

              {touched.password && errors.password && (
                <Text
                  style={{ color: COLORS.red, fontSize: 14, marginBottom: 10 }}
                >
                  {errors.password}
                </Text>
              )}
            </View>

            {/* Bottom Section */}
            <View style={{ marginBottom: 20 }}>
              <TouchableOpacity
                disabled={!isValid || isLoading}
                onPress={handleSubmit}
                style={{
                  backgroundColor: COLORS.primary,
                  height: 56,
                  borderRadius: 12,
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: !isValid ? 0.7 : 1,
                  marginBottom: 12,
                }}
              >
                {isLoading ? (
                  <ActivityIndicator size="large" color={COLORS.white} />
                ) : (
                  <Text
                    style={{
                      color: COLORS.white,
                      fontSize: 18,
                      fontWeight: "bold",
                    }}
                  >
                    Login
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => navigation.navigate("Qrscan")}
                style={{
                  borderColor: COLORS.primary,
                  borderWidth: 1,
                  backgroundColor: COLORS.white,
                  height: 56,
                  borderRadius: 12,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: COLORS.primary,
                    fontSize: 18,
                    fontWeight: "600",
                  }}
                >
                  Rescan QR Code
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Formik>
    </KeyboardAvoidingView>
  );
}

export default Login;

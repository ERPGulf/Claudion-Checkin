import React, { useState } from "react";
import { getNotifications } from "../services/api/notification.service";
import { setUnreadCount } from "../redux/Slices/notificationSlice";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
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
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { generateToken } from "../services/api";

function Login() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const employeeCode = useSelector(selectEmployeeCode);

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

      const { access_token } = await generateToken({
        api_key,
        app_key,
        api_secret: password,
      });

      if (!access_token) throw new Error("Token not returned from server");

      if (employeeCode) {
        await AsyncStorage.setItem("employee_id", employeeCode);
      }

      dispatch(setSignIn({ isLoggedIn: true, token: access_token }));

      // 🔔 NEW: fetch notifications at login
      try {
        const employeeId = await AsyncStorage.getItem("employee_id");

        if (employeeId) {
          const notifications = await getNotifications(employeeId);

          const unreadCount = notifications.filter(
            (item) => Number(item.read) === 0,
          ).length;

          dispatch(setUnreadCount(unreadCount));
        }
      } catch (err) {}
      Toast.show({
        type: "success",
        text1: "Login successful",
        autoHide: true,
        visibilityTime: 3000,
      });

      // navigation.navigate("homeTab");
    } catch (error) {
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
        }) => {
          const isSubmitDisabled = !isValid || isLoading;

          return (
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
                    style={{
                      color: COLORS.red,
                      fontSize: 14,
                      marginBottom: 10,
                    }}
                  >
                    {errors.password}
                  </Text>
                )}
              </View>

              {/* Bottom Section */}
              <View style={styles.bottomActions}>
                <Pressable
                  disabled={isSubmitDisabled}
                  onPress={handleSubmit}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    isSubmitDisabled && styles.primaryButtonDisabled,
                    pressed && !isSubmitDisabled && styles.buttonPressed,
                  ]}
                >
                  {isLoading ? (
                    <ActivityIndicator size="large" color={COLORS.white} />
                  ) : (
                    <View style={styles.buttonContent}>
                      <Ionicons
                        name="log-in-outline"
                        size={20}
                        color={COLORS.white}
                        style={styles.buttonIcon}
                      />
                      <Text style={styles.primaryButtonText}>Login</Text>
                    </View>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => navigation.navigate("Qrscan")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.buttonContent}>
                    <Ionicons
                      name="qr-code-outline"
                      size={20}
                      color={COLORS.primary}
                      style={styles.buttonIcon}
                    />
                    <Text style={styles.secondaryButtonText}>
                      Rescan QR Code
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          );
        }}
      </Formik>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#F3F2F6",
    borderWidth: 1,
    borderColor: "#E7E5EC",
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  primaryButton: {
    backgroundColor: COLORS.brandPrimary,
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: COLORS.brandPrimary,
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  secondaryButton: {
    borderColor: "#D0CCD8",
    borderWidth: 1,
    backgroundColor: COLORS.white,
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  buttonIcon: {
    marginRight: 8,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});

export default Login;

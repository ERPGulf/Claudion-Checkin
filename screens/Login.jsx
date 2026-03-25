import React, { useState } from "react";
import { getNotifications } from "../services/api/notification.service";
import { setUnreadCount } from "../redux/Slices/notificationSlice";
import SubmitButton from "../components/common/SubmitButton";

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
        backgroundColor: "#FFF",
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
                  color: "#000",
                  fontFamily: "Inter-regular",
                  fontSize: 20,
                  lineHeight: 24,
                  paddingTop: 26,
                  paddingBottom: 8,
                  paddingRight: 106,
                }}
              >
                Enter your password here!
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "#FFF",
                  borderWidth: 1,
                  borderColor: "#63205F",
                  borderRadius: 7,

                  width: 358,
                  height: 56,

                  paddingHorizontal: 12,
                  paddingLeft: 19,

                  marginBottom: 10,
                }}
              >
                <TextInput
                  secureTextEntry={!showPassword}
                  value={values.password}
                  onChangeText={handleChange("password")}
                  placeholder="Enter password"
                  placeholderTextColor="#B3B3B3"
                  onBlur={() => setFieldTouched("password")}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontFamily: "Inter-Regular",
                    color: "#000",

                    textAlignVertical: "center",
                    paddingVertical: 0,
                    includeFontPadding: false,
                  }}
                />

                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={{
                    width: 35,
                    height: 35,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name={showPassword ? "eye" : "eye-off"}
                    size={29}
                    style={{
                      width: 32,
                      height: 29,
                    }}
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

            <View style={{ marginTop: "auto", marginBottom: 20 }}>
              {/* LOGIN BUTTON */}
              <SubmitButton
                title="Login"
                onPress={handleSubmit}
                loading={isLoading} // ✅ added
                disabled={!isValid || isLoading} // ✅ added
                height={48}
                borderRadius={7}
                style={{
                  marginHorizontal: 16,
                  marginBottom: 12,
                }}
                textStyle={{
                  fontSize: 18,
                  fontFamily: "Inter-Medium",
                }}
              />

              {/* RESCAN BUTTON */}
              <TouchableOpacity
                style={{
                  marginHorizontal: 16,
                  height: 48,
                  borderRadius: 7,
                  borderWidth: 1,
                  borderColor: "#333",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#FFF",
                }}
                onPress={() => navigation.navigate("Qrscan")} // ✅ updated
              >
                <Text
                  style={{
                    color: "#000",
                    fontSize: 18,
                    fontFamily: "Inter-Medium",
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

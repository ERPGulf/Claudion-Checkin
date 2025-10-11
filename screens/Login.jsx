
import React, { useState } from "react";
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
import { generateToken } from "../api/userApi";
import { COLORS, SIZES } from "../constants";
import { WelcomeCard } from "../components/Login";
import { selectEmployeeCode, selectName } from "../redux/Slices/UserSlice";

function Login() {
  const navigation = useNavigation();
  const dispatch = useDispatch();

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ✅ Get employee info from Redux
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
      if (refresh_token) {
        await AsyncStorage.setItem("refresh_token", refresh_token);
      }

      dispatch(setSignIn({ isLoggedIn: true, access_token }));

      Toast.show({
        type: "success",
        text1: "Login successful",
        autoHide: true,
        visibilityTime: 3000,
      });

      navigation.navigate("homeTab");
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
          <View
            style={{ flex: 1, justifyContent: "flex-end", marginBottom: 20 }}
          >
            {/* Employee Info */}
            {employeeCode && fullName && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 16, color: COLORS.grayText }}>
                  Welcome, {fullName}
                </Text>
                <Text style={{ fontSize: 14, color: COLORS.grayText }}>
                  Employee Code: {employeeCode}
                </Text>
              </View>
            )}

            {/* Password Input */}
            <Text
              style={{ color: COLORS.grayText, fontSize: 16, marginBottom: 5 }}
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
                marginBottom: 5,
              }}
            >
              <TextInput
                secureTextEntry={!showPassword}
                value={values.password}
                onChangeText={handleChange("password")}
                placeholder="Enter password"
                onBlur={() => setFieldTouched("password")}
                style={{ flex: 1, fontSize: 16, height: "100%" }}
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

            {/* Login Button */}
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

            {/* Rescan QR */}
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
        )}
      </Formik>
    </KeyboardAvoidingView>
  );
}

export default Login;

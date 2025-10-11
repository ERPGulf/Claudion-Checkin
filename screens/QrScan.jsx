import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useEffect, useLayoutEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import base64 from "react-native-base64";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDispatch } from "react-redux";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { CameraView, Camera, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import {
  setBaseUrl,
  setUsername,
  setFullname,
} from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";
import { setEmployeeCode} from "../redux/Slices/UserSlice";

function QrScan() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Scan QR Code",
      headerTitleAlign: "center",
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, []);

 
  const handleQRCodeData = async (data) => {
    try {
      // Decode base64
      let value = base64.decode(data);
      console.log("📥 Raw Decoded QR:", value);

      // Add newlines for safer parsing
      value = value
        .replace(/Company:/g, "\nCompany:")
        .replace(/Employee_Code:/g, "\nEmployee_Code:")
        .replace(/Full_Name:/g, "\nFull_Name:")
        .replace(/User_id:/g, "\nUser_id:")
        .replace(/API:/g, "\nAPI:")
        .replace(/App_key:/g, "\nApp_key:");

      // Helper to clean strings
      const cleanString = (str) => str.replace(/[\u0000-\u001F]+/g, "").trim();

      // Extract values
      const employeeMatch = value.match(/Employee_Code:\s*([^\n\r]+)/i);
      const fullNameMatch = value.match(/Full_Name:\s*([^\n\r]+)/i);
      const userIdMatch = value.match(/User_id:\s*([^\n\r]+)/i);
      const apiMatch = value.match(/API:\s*(https?:\/\/[^\s]+)/i);
      const appKeyMatch = value.match(/App_key:\s*([^\n\r]+)/i);

      if (
        employeeMatch &&
        fullNameMatch &&
        userIdMatch &&
        apiMatch &&
        appKeyMatch
      ) {
        const employee_code = cleanString(employeeMatch[1]);
        const full_name = cleanString(fullNameMatch[1]);
        const api_key = cleanString(userIdMatch[1]);
        const app_key = cleanString(appKeyMatch[1]);
        const baseUrl = cleanString(apiMatch[1]).replace(/\/$/, "");

        console.log("✅ Cleaned QR Data:", {
          employee_code,
          full_name,
          api_key,
          app_key,
          baseUrl,
        });

        // Save all to AsyncStorage
        await AsyncStorage.multiSet([
          ["employee_code", employee_code],
          ["full_name", full_name],
          ["api_key", api_key],
          ["app_key", app_key],
          ["baseUrl", baseUrl],
        ]);

        // Update Redux
        dispatch(setUsername(api_key));
        dispatch(setFullname(full_name));
        dispatch(setBaseUrl(baseUrl));
        dispatch(setEmployeeCode(employee_code)); // ✅ Make sure this exists in your slice

        // Navigate to login
        navigation.navigate("login");
      } else {
        alert("Invalid QR code. Please try again.");
      }
    } catch (error) {
      console.log("❌ QR parse error:", error);
      alert("Invalid QR code");
    }
  };

  const handleBarCodeScanned = async ({ type, data }) => {
    setScanned(true);
    await handleQRCodeData(data);
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result?.canceled) return;
      if (result?.assets[0]?.uri) {
        const scannedResults = await Camera.scanFromURLAsync(
          result.assets[0].uri
        );
        const { data } = scannedResults[0];
        await handleQRCodeData(data);
      }
    } catch (error) {
      alert("No QR-CODE Found");
    }
  };

  if (!permission || permission.status === "undetermined") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-3 bg-white relative">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-3 bg-white relative">
        <Text>No access to camera</Text>
      </SafeAreaView>
    );
  }

  return (
    <CameraView
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={handleBarCodeScanned}
      style={{ flex: 1, width: "100%", height: "100%" }}
      type="back"
      className="flex-1 items-center px-3 py-1 bg-white justify-end relative"
    >
      <View
        style={{ position: "absolute", top: 100, height: SIZES.width * 0.9 }}
        className="w-full bg-transparent border-4 border-white/50 rounded-2xl justify-center items-center"
      >
        <Ionicons
          name="qr-code-outline"
          size={SIZES.width * 0.6}
          color="rgba(255,255,255,0.1)"
        />
      </View>

      <View
        style={{
          width: "100%",
          flex: 0.2,
          justifyContent: "flex-end",
          paddingVertical: 20,
        }}
      >
        {scanned ? (
          <TouchableOpacity
            style={{ backgroundColor: COLORS.primary, width: "100%" }}
            className="mt-2 h-16 justify-center rounded-xl items-center flex-row space-x-2"
            onPress={() => setScanned(false)}
          >
            <Ionicons name="scan-outline" size={SIZES.xxxLarge} color="white" />
            <Text className="text-base text-center font-semibold text-white">
              TAP TO SCAN AGAIN
            </Text>
          </TouchableOpacity>
        ) : (
          <View
            className="h-16 justify-center rounded-xl bg-white border-2 items-center mt-4 flex-row"
            style={{ width: "100%" }}
          >
            <Ionicons
              name="qr-code-outline"
              size={SIZES.xxxLarge}
              color={COLORS.primary}
            />
          </View>
        )}

        <TouchableOpacity
          style={{ backgroundColor: COLORS.primary, width: "100%" }}
          className=" mt-2 h-16 justify-center flex-row items-center rounded-xl relative"
          onPress={pickImage}
        >
          <Ionicons
            name="image"
            size={SIZES.xxxLarge}
            color="white"
            className="mr-2"
          />
          <Text className="text-base text-center font-semibold text-white">
            SELECT FROM PHOTOS
          </Text>
        </TouchableOpacity>
      </View>
    </CameraView>
  );
}

export default QrScan;

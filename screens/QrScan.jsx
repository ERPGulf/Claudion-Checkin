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
import { setEmployeeCode } from "../redux/Slices/UserSlice";

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
      // Decode base64 safely
      let value = base64.decode(data);
      console.log("📥 Raw Decoded QR:", value);

      // Normalize the data
      value = value.replace(/&/g, " ").replace(/\s+/g, " ").trim();

      // Function to extract between markers
      const extractValue = (text, startKey, endKey) => {
        const startIndex = text.indexOf(startKey);
        if (startIndex === -1) return null;
        const endIndex =
          endKey && text.indexOf(endKey, startIndex + startKey.length);
        const raw =
          !endKey || endIndex === -1
            ? text.substring(startIndex + startKey.length)
            : text.substring(startIndex + startKey.length, endIndex);

        // Remove extra spaces, non-breaking, and control characters
        return raw.replace(/[\u0000-\u001F\u00A0]+/g, "").trim();
      };

      // Extract each field
      const company = extractValue(value, "Company:", "Employee_Code:");
      const employee_code = extractValue(value, "Employee_Code:", "Full_Name:");
      const full_name = extractValue(value, "Full_Name:", "User_id:");
      const api_key = extractValue(value, "User_id:", "API:");
      const baseUrl = extractValue(value, "API:", "App_key:");
      const app_key = extractValue(value, "App_key:");

      // Validate required fields
      if (employee_code && full_name && api_key && baseUrl && app_key) {
        console.log("✅ Cleaned QR Data:", {
          company,
          employee_code,
          full_name,
          api_key,
          baseUrl,
          app_key,
        });

        // Save all to AsyncStorage
        await AsyncStorage.multiSet([
          ["company", company],
          ["employee_code", employee_code],
          ["full_name", full_name],
          ["api_key", api_key],
          ["app_key", app_key],
          ["baseUrl", baseUrl.replace(/\/$/, "")],
        ]);

        // Dispatch Redux updates
        dispatch(setUsername(api_key));
        dispatch(setFullname(full_name));
        dispatch(setBaseUrl(baseUrl));
        dispatch(setEmployeeCode(employee_code));

        // Navigate to login
        navigation.navigate("login");
      } else {
        console.log("❌ Parsing failed:", value);
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

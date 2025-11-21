// NOSONAR
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useEffect, useLayoutEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import base64 from "base-64";
import utf8 from "utf8";
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
  setEmployeeCode,
} from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";
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
      const KEYS = [
        "Company",
        "Employee_Code",
        "Full_Name",
        "Photo",
        "Restrict Location",   // :point_left: NEW FIELD
        "User_id",
        "API",
        "App_key",
      ];
      // :one: Decode Base64
      let value = utf8.decode(base64.decode(data));
      console.log(":inbox_tray: Raw Decoded QR:", value);
      // :two: Clean up weird characters
      value = value
        .replace(/[\u0000-\u001F\u00A0]+/g, " ")
        .replace(
          /[%#;]+(?:\s+)?(Company|Employee_Code|Full_Name|Photo|Restrict Location|User_id|API|App_key)(?:\s*[:=])/g,
          (_, key) => `${key}:`
        )
        .replace(/[^\S\r\n]+/g, " ")
        .trim();
      // :three: Dynamic extraction
      const qrData = {};
      const keyAlt = KEYS.join("|");
      const pairRE = new RegExp(
        `\\b(${keyAlt})\\s*[:=]\\s*([\\s\\S]*?)(?=\\s*(?:${keyAlt})\\s*[:=]|$)`,
        "gi"
      );
      let m;
      while ((m = pairRE.exec(value))) {
        const k = m[1].trim();
        const v = m[2].trim();
        qrData[k] = v;
      }
      // :four: Trailing cleanup
      Object.keys(qrData).forEach((k) => {
        qrData[k] = qrData[k].replace(/[%#;]+$/, "").trim();
      });
      // :five: App_key fix
      let appKey = qrData["App_key"]?.trim() || "";
      const missingPadding = appKey.length % 4;
      if (missingPadding) {
        appKey = appKey.padEnd(appKey.length + (4 - missingPadding), "=");
      }
      if (!appKey.endsWith("==")) {
        if (appKey.endsWith("=")) appKey = appKey.slice(0, -1) + "==";
        else appKey += "==";
      }
      // :six: Photo default=1
      const photoFlag = qrData["Photo"]
        ? Number.parseInt(qrData["Photo"], 10)
        : 1;
      // :seven: Build final object
      const cleanedData = {
        company: qrData["Company"],
        employee_code: qrData["Employee_Code"],
        full_name: qrData["Full_Name"]?.trim(),
        api_key: qrData["User_id"]?.trim(),
        baseUrl: qrData["API"]?.trim(),
        app_key: appKey,
        photo: photoFlag,
        restrict_location: qrData["Restrict Location"]?.trim() ?? "0", // :point_left: NEW
      };
      console.log(":white_check_mark: Cleaned QR:", cleanedData);
      // :eight: Validate required fields
      if (
        cleanedData.company &&
        cleanedData.employee_code &&
        cleanedData.baseUrl
      ) {
        await AsyncStorage.multiSet([
          ["company", cleanedData.company],
          ["employee_code", cleanedData.employee_code],
          ["full_name", cleanedData.full_name],
          ["api_key", cleanedData.api_key],
          ["app_key", cleanedData.app_key],
          ["baseUrl", cleanedData.baseUrl],
          ["photo", String(cleanedData.photo)],
          ["restrict_location", cleanedData.restrict_location], // :point_left: NEW
        ]);
        // Redux dispatch (NO restrict_location)
        dispatch(setUsername(cleanedData.api_key));
        dispatch(setFullname(cleanedData.full_name));
        dispatch(setBaseUrl(cleanedData.baseUrl));
        dispatch(setEmployeeCode(cleanedData.employee_code));
        navigation.navigate("login");
      } else {
        alert("Invalid QR code. Please try again.");
      }
    } catch (err) {
      console.log(":x: QR parse error:", err);
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
      if (result.assets[0]?.uri) {
        const scannedResults = await Camera.scanFromURLAsync(
          result.assets[0].uri
        );
        const { data } = scannedResults[0];
        await handleQRCodeData(data);
      }
    } catch {
      alert("No QR-CODE Found");
    }
  };
  if (!permission || permission.status === "undetermined") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-3 bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }
  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-3 bg-white">
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
      className="flex-1 items-center px-3 py-1 bg-white justify-end"
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
            style={{ backgroundColor: COLORS.primary }}
            className="mt-2 h-16 justify-center rounded-xl items-center flex-row"
            onPress={() => setScanned(false)}
          >
            <Ionicons name="scan-outline" size={SIZES.xxxLarge} color="white" />
            <Text className="text-base font-semibold text-white ml-2">
              TAP TO SCAN AGAIN
            </Text>
          </TouchableOpacity>
        ) : (
          <View className="h-16 justify-center rounded-xl bg-white border-2 items-center mt-4">
            <Ionicons
              name="qr-code-outline"
              size={SIZES.xxxLarge}
              color={COLORS.primary}
            />
          </View>
        )}
        <TouchableOpacity
          style={{ backgroundColor: COLORS.primary }}
          className="mt-2 h-16 justify-center flex-row items-center rounded-xl"
          onPress={pickImage}
        >
          <Ionicons name="image" size={SIZES.xxxLarge} color="white" />
          <Text className="text-base font-semibold text-white ml-2">
            SELECT FROM PHOTOS
          </Text>
        </TouchableOpacity>
      </View>
    </CameraView>
  );
}
export default QrScan;
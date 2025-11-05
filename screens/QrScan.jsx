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
      const KEYS = [
        "Company",
        "Employee_Code",
        "Full_Name",
        "Photo",
        "User_id",
        "API",
        "App_key",
      ];

      // 1️⃣ Decode base64
      let value = base64.decode(data);
      console.log("📥 Raw Decoded QR:", value);

      // 2️⃣ Clean unwanted control characters or delimiters

      value = value
        .replace(/[\u0000-\u001F\u00A0]+/g, " ")
        .replace(
          /[%#;]+(?:\s+)?(Company|Employee_Code|Full_Name|Photo|User_id|API|App_key)(?:\s*[:=])/g,
          (_, key) => `${key}:`
        )
        .replace(/[^\S\r\n]+/g, " ")
        .trim();

      // 3️⃣ Extract key/value pairs dynamically
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

      // 4️⃣ Clean trailing symbols in values
      Object.keys(qrData).forEach((k) => {
        qrData[k] = qrData[k].replace(/[%#;]+$/, "").trim();
      });

      // 5️⃣ Handle App_key carefully
      let appKey = qrData["App_key"]?.trim() || "";
      const missingPadding = appKey.length % 4;
      if (missingPadding) {
        appKey = appKey.padEnd(appKey.length + (4 - missingPadding), "=");
      }
      if (!appKey.endsWith("==")) {
        if (appKey.endsWith("=")) appKey = appKey.slice(0, -1) + "==";
        else appKey += "==";
      }

      // 6️⃣ Parse photo flag (default = 1)
      const photoFlag = qrData["Photo"]
        ? Number.parseInt(qrData["Photo"], 10)
        : 1;

      // 7️⃣ Build final cleaned data
      const cleanedData = {
        company: qrData["Company"],
        employee_code: qrData["Employee_Code"],
        full_name: qrData["Full_Name"]?.trim(),
        api_key: qrData["User_id"]?.trim(),
        baseUrl: qrData["API"]?.trim(),
        app_key: appKey,
        photo: photoFlag,
      };

      console.log("✅ Cleaned QR Data:", cleanedData);

      // 8️⃣ Validate and store
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
          ["photo", String(cleanedData.photo)], // ✅ store photo flag
        ]);

        dispatch(setUsername(cleanedData.api_key));
        dispatch(setFullname(cleanedData.full_name));
        dispatch(setBaseUrl(cleanedData.baseUrl));
        dispatch(setEmployeeCode(cleanedData.employee_code));

        navigation.navigate("login");
      } else {
        console.log("❌ Parsing failed:", value);
        alert("Invalid QR code. Please try again.");
      }
    } catch (err) {
      console.log("❌ QR parse error:", err);
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

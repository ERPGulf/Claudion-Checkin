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
import { LinearGradient } from "expo-linear-gradient";
import SubmitButton from "../components/common/SubmitButton";
import {
  setBaseUrl,
  setUsername,
  setFullname,
  setEmployeeCode,
} from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";
import { StyleSheet } from "react-native";
function QrScan() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const dispatch = useDispatch();
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  const handleQRCodeData = async (data) => {
    try {
      const KEYS = [
        "Company",
        "Employee_Code",
        "Full_Name",
        "Photo",
        "Restrict Location", // :point_left: NEW FIELD
        "User_id",
        "API",
        "App_key",
      ];
      // :one: Decode Base64
      let value = utf8.decode(base64.decode(data));
      // :two: Clean up weird characters
      value = value
        .replace(/[\u0000-\u001F\u00A0]+/g, " ")
        .replace(
          /[%#;]+(?:\s+)?(Company|Employee_Code|Full_Name|Photo|Restrict Location|User_id|API|App_key)(?:\s*[:=])/g,
          (_, key) => `${key}:`,
        )
        .replace(/[^\S\r\n]+/g, " ")
        .trim();
      // :three: Dynamic extraction
      const qrData = {};
      const keyAlt = KEYS.join("|");
      const pairRE = new RegExp(
        `\\b(${keyAlt})\\s*[:=]\\s*([\\s\\S]*?)(?=\\s*(?:${keyAlt})\\s*[:=]|$)`,
        "gi",
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
          result.assets[0].uri,
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
    <SafeAreaView
      edges={["top"]}
      style={{
        flex: 1,
        backgroundColor: "#FFFFFF",
      }}
    >
      <LinearGradient
        colors={["#F6D4BC", "#C45D2F"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          height: 69,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 9,
          paddingRight: 82,
          borderWidth: 0.5,
          borderColor: "#D3551D",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: "100%",
            height: 56,
            flexDirection: "row",
            alignItems: "center",
            paddingRight: 82,
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              width: 40,
              height: 40,
              justifyContent: "center",
              alignItems: "center",
              marginRight: 25,
              marginLeft: 9,
            }}
          >
            <Entypo name="chevron-left" size={28} color="black" />
          </TouchableOpacity>

          <Text
            style={{
              fontSize: 22,
              fontWeight: "600",
              color: "#000",
            }}
          >
            Scan your QR code!
          </Text>
        </View>
      </LinearGradient>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarCodeScanned}
        style={{ flex: 1, width: "100%" }}
        type="back"
        className="flex-1 items-center px-3 py-1 justify-end"
      >
        <View style={styles.scanFrame}>
          <View style={styles.topLeftH} />
          <View style={styles.topLeftV} />

          <View style={styles.bottomLeftH} />
          <View style={styles.bottomLeftV} />

          <View style={styles.topRightH} />
          <View style={styles.topRightV} />

          <View style={styles.bottomRightH} />
          <View style={styles.bottomRightV} />
        </View>
        <View style={{ width: "100%", alignItems: "center", marginBottom: 20 }}>
          <LinearGradient
            colors={["#77224C", "#8E273B"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{
              borderRadius: 7,
              paddingTop: 13,
              paddingBottom: 14,
              width: "90%",
              paddingVertical: 14,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: 22,
                fontWeight: "500",
                color: "#FFFFFF",
              }}
            >
              Upload from Files/Photos
            </Text>
          </LinearGradient>
        </View>
      </CameraView>
    </SafeAreaView>
  );
}
export default QrScan;

const styles = StyleSheet.create({
  scanFrame: {
    position: "absolute",
    top: "30%",
    width: 220,
    height: 229,
    alignSelf: "center",
  },
  topLeftH: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 40,
    height: 2,
    backgroundColor: "#444",
  },
  topLeftV: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 2,
    height: 60,
    backgroundColor: "#444",
  },

  bottomLeftH: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 40,
    height: 2,
    backgroundColor: "#444",
  },
  bottomLeftV: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 2,
    height: 60,
    backgroundColor: "#444",
  },

  topRightH: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 40,
    height: 2,
    backgroundColor: "#444",
  },
  topRightV: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 2,
    height: 60,
    backgroundColor: "#444",
  },

  bottomRightH: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 40,
    height: 2,
    backgroundColor: "#444",
  },
  bottomRightV: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 2,
    height: 60,
    backgroundColor: "#444",
  },
});

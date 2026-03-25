// NOSONAR
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import base64 from "base-64";
import utf8 from "utf8";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDispatch } from "react-redux";
import { Entypo } from "@expo/vector-icons";
import { CameraView, Camera, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import SubmitButton from "../components/common/SubmitButton";
import {
  setBaseUrl,
  setUsername,
  setFullname,
  setEmployeeCode,
} from "../redux/Slices/UserSlice";
import { StyleSheet } from "react-native";

function QrScan() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);
  useFocusEffect(
    useCallback(() => {
      setScanned(false);
    }, []),
  );

  // ✅ MAIN HANDLER (UPDATED)
  const handleQRCodeData = async (data, qrImage = null) => {
    try {
      const KEYS = [
        "Company",
        "Employee_Code",
        "Full_Name",
        "Photo",
        "Restrict Location",
        "User_id",
        "API",
        "App_key",
      ];

      let value = utf8.decode(base64.decode(data));

      value = value
        .replace(/[\u0000-\u001F\u00A0]+/g, " ")
        .replace(
          /[%#;]+(?:\s+)?(Company|Employee_Code|Full_Name|Photo|Restrict Location|User_id|API|App_key)(?:\s*[:=])/g,
          (_, key) => `${key}:`,
        )
        .replace(/[^\S\r\n]+/g, " ")
        .trim();

      const qrData = {};
      const keyAlt = KEYS.join("|");

      const pairRE = new RegExp(
        `\\b(${keyAlt})\\s*[:=]\\s*([\\s\\S]*?)(?=\\s*(?:${keyAlt})\\s*[:=]|$)`,
        "gi",
      );

      let m;
      while ((m = pairRE.exec(value))) {
        qrData[m[1].trim()] = m[2].trim();
      }

      let appKey = qrData["App_key"]?.trim() || "";
      if (appKey.length % 4) {
        appKey = appKey.padEnd(appKey.length + (4 - (appKey.length % 4)), "=");
      }

      const cleanedData = {
        company: qrData["Company"],
        employee_code: qrData["Employee_Code"],
        full_name: qrData["Full_Name"]?.trim(),
        api_key: qrData["User_id"]?.trim(),
        baseUrl: qrData["API"]?.trim(),
        app_key: appKey,
        photo: qrData["Photo"] ? parseInt(qrData["Photo"], 10) : 1,
        restrict_location: qrData["Restrict Location"]?.trim() ?? "0",
      };

      if (
        cleanedData.company &&
        cleanedData.employee_code &&
        cleanedData.baseUrl
      ) {
        navigation.navigate("QrPreview", {
          data: cleanedData,
          qrImage: qrImage,
        });
      } else {
        setScanned(false);
        alert("Invalid QR code");
      }
    } catch {
      setScanned(false);
      alert("Invalid QR code");
    }
  };

  // ✅ Camera Scan
  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    await handleQRCodeData(data, null);
  };

  // ✅ Gallery Scan (FIXED)
  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (result?.canceled) return;

      const imageUri = result.assets[0]?.uri;

      if (imageUri) {
        const scannedResults = await Camera.scanFromURLAsync(imageUri);

        if (!scannedResults?.length) {
          alert("No QR-CODE Found");
          return;
        }

        const { data } = scannedResults[0];

        await handleQRCodeData(data, imageUri); // ✅ PASS IMAGE
      }
    } catch {
      alert("No QR-CODE Found");
    }
  };

  if (!permission || permission.status === "undetermined") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text>No access to camera</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: "#fff" }}
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
      {/* CAMERA */}
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarCodeScanned}
        style={{ flex: 1 }}
      >
        <View style={styles.scanFrame} />
      </CameraView>

      {/* ✅ BUTTON OUTSIDE CAMERA */}
      <View style={styles.bottomButtonContainer}>
        <SubmitButton
          title="Upload from Files/Photos"
          onPress={pickImage}
          style={{ width: "90%" }}
        />
      </View>
    </SafeAreaView>
  );
}

export default QrScan;

const styles = StyleSheet.create({
  scanFrame: {
    position: "absolute",
    top: "30%",
    width: 220,
    height: 220,
    alignSelf: "center",
    borderWidth: 2,
    borderColor: "#444",
  },
  bottomButtonContainer: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: "center",
  },
});

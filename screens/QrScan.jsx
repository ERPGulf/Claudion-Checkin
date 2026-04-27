// NOSONAR
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
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

const BRAND_PRIMARY = "hsl(188, 84%, 14%)";

function QrScan() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

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
  }, [navigation]);

  const handleQRCodeData = async (data) => {
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
        const k = m[1].trim();
        const v = m[2].trim();
        qrData[k] = v;
      }

      Object.keys(qrData).forEach((k) => {
        qrData[k] = qrData[k].replace(/[%#;]+$/, "").trim();
      });

      let appKey = qrData["App_key"]?.trim() || "";
      const missingPadding = appKey.length % 4;
      if (missingPadding) {
        appKey = appKey.padEnd(appKey.length + (4 - missingPadding), "=");
      }
      if (!appKey.endsWith("==")) {
        if (appKey.endsWith("=")) appKey = appKey.slice(0, -1) + "==";
        else appKey += "==";
      }

      const photoFlag = qrData["Photo"]
        ? Number.parseInt(qrData["Photo"], 10)
        : 1;

      const cleanedData = {
        company: qrData["Company"],
        employee_code: qrData["Employee_Code"],
        full_name: qrData["Full_Name"]?.trim(),
        api_key: qrData["User_id"]?.trim(),
        baseUrl: qrData["API"]?.trim(),
        app_key: appKey,
        photo: photoFlag,
        restrict_location: qrData["Restrict Location"]?.trim() ?? "0",
      };

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
          ["restrict_location", cleanedData.restrict_location],
        ]);

        dispatch(setUsername(cleanedData.api_key));
        dispatch(setFullname(cleanedData.full_name));
        dispatch(setBaseUrl(cleanedData.baseUrl));
        dispatch(setEmployeeCode(cleanedData.employee_code));
        navigation.navigate("login");
        return true;
      } else {
        Alert.alert("Invalid QR", "Please scan a valid Claudion QR code.");
        return false;
      }
    } catch {
      Alert.alert("Invalid QR", "Please scan a valid Claudion QR code.");
      return false;
    }
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned || isProcessing) return;

    setScanned(true);
    setIsProcessing(true);
    const isValid = await handleQRCodeData(data);
    setIsProcessing(false);
    if (!isValid) setScanned(false);
  };

  const pickImage = async () => {
    try {
      setIsProcessing(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result?.canceled) {
        setIsProcessing(false);
        return;
      }

      if (result?.assets?.[0]?.uri) {
        setScanned(true);
        const scannedResults = await Camera.scanFromURLAsync(
          result.assets[0].uri,
        );
        if (!scannedResults?.length || !scannedResults[0]?.data) {
          Alert.alert(
            "No QR Found",
            "Please choose an image with a visible QR code.",
          );
          setScanned(false);
          setIsProcessing(false);
          return;
        }
        const { data } = scannedResults[0];
        const isValid = await handleQRCodeData(data);
        if (!isValid) setScanned(false);
      }
    } catch {
      Alert.alert(
        "No QR Found",
        "Please choose an image with a visible QR code.",
      );
      setScanned(false);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!permission || permission.status === "undetermined") {
    return (
      <SafeAreaView style={styles.stateContainer}>
        <ActivityIndicator size="large" color={BRAND_PRIMARY} />
        <Text style={styles.stateText}>Preparing camera...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.stateContainer}>
        <Ionicons name="camera-outline" size={50} color={COLORS.gray} />
        <Text style={styles.stateTitle}>Camera access required</Text>
        <Text style={styles.stateText}>
          Allow camera permission to scan your Claudion QR code.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={requestPermission}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryButtonText}>ALLOW CAMERA</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <CameraView
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={
        scanned || isProcessing ? undefined : handleBarCodeScanned
      }
      style={styles.camera}
      type="back"
      className="flex-1 items-center justify-end"
    >
      <View style={styles.cameraOverlay} />

      <View style={styles.scanFrameContainer}>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
          <Ionicons
            name="qr-code-outline"
            size={SIZES.width * 0.48}
            color="rgba(17,14,17,0.12)"
          />
        </View>
      </View>

      <View style={styles.bottomSheet}>
        <Text style={styles.sheetTitle}>Align QR inside frame</Text>
        <Text style={styles.sheetSubtitle}>
          We will detect and continue automatically.
        </Text>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={scanned ? () => setScanned(false) : pickImage}
          activeOpacity={0.88}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Ionicons
              name={scanned ? "scan-outline" : "image-outline"}
              size={SIZES.xxxLarge - 2}
              color={COLORS.white}
            />
          )}
          <Text style={styles.actionButtonText}>
            {isProcessing
              ? "PROCESSING..."
              : scanned
                ? "TAP TO SCAN AGAIN"
                : "SELECT FROM PHOTOS"}
          </Text>
        </TouchableOpacity>
      </View>
    </CameraView>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: COLORS.white,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  scanFrameContainer: {
    position: "absolute",
    top: 95,
    width: "100%",
    alignItems: "center",
  },
  scanFrame: {
    width: SIZES.width * 0.82,
    height: SIZES.width * 0.82,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(17,14,17,0.22)",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.36)",
  },
  corner: {
    position: "absolute",
    width: 34,
    height: 34,
    borderColor: BRAND_PRIMARY,
  },
  cornerTopLeft: {
    top: 12,
    left: 12,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 10,
  },
  cornerTopRight: {
    top: 12,
    right: 12,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  cornerBottomLeft: {
    bottom: 12,
    left: 12,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  cornerBottomRight: {
    bottom: 12,
    right: 12,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 10,
  },
  bottomSheet: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(17,14,17,0.08)",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
  },
  sheetTitle: {
    color: COLORS.primary,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  sheetSubtitle: {
    marginTop: 4,
    color: "#5A5760",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 14,
  },
  actionButton: {
    height: 58,
    borderRadius: 14,
    backgroundColor: BRAND_PRIMARY,
    shadowColor: BRAND_PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  stateContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  stateTitle: {
    marginTop: 12,
    color: COLORS.primary,
    fontSize: 20,
    fontWeight: "700",
  },
  stateText: {
    marginTop: 8,
    color: COLORS.gray,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
  },
  primaryButton: {
    marginTop: 18,
    height: 50,
    minWidth: 180,
    borderRadius: 12,
    backgroundColor: BRAND_PRIMARY,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
});

export default QrScan;

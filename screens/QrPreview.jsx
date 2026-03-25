import React from "react";
import { View, Text, Image, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDispatch } from "react-redux";
import QRCode from "react-native-qrcode-svg";
import {
  setBaseUrl,
  setUsername,
  setFullname,
  setEmployeeCode,
} from "../redux/Slices/UserSlice";

export default function QrPreview({ route, navigation }) {
  const { data: qrData, qrImage } = route.params || {};
  const dispatch = useDispatch();

  if (!qrData) {
    return (
      <View>
        <Text>No QR data found</Text>
      </View>
    );
  }

  const handleAccept = async () => {
    await AsyncStorage.multiSet([
      ["company", qrData.company],
      ["employee_code", qrData.employee_code],
      ["full_name", qrData.full_name],
      ["api_key", qrData.api_key],
      ["app_key", qrData.app_key],
      ["baseUrl", qrData.baseUrl],
      ["photo", String(qrData.photo)],
      ["restrict_location", qrData.restrict_location],
    ]);

    dispatch(setUsername(qrData.api_key));
    dispatch(setFullname(qrData.full_name));
    dispatch(setBaseUrl(qrData.baseUrl));
    dispatch(setEmployeeCode(qrData.employee_code));

     navigation.navigate("login");
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#fff",
        paddingHorizontal: 20,
        justifyContent: "space-between",
      }}
    >
      <View />

      {/* ✅ QR BOX */}
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 235,
            height: 235,
            borderWidth: 1,
            borderColor: "#ccc",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {qrImage ? (
            <Image
              source={{ uri: qrImage }}
              style={{ width: "90%", height: "90%" }}
              resizeMode="contain"
            />
          ) : (
            <QRCode value={JSON.stringify(qrData)} size={200} />
          )}
        </View>
      </View>

      {/* ✅ BUTTONS */}
      <View style={{ flexDirection: "row", marginBottom: 30 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            flex: 1,
            marginRight: 10,
            height: 50,
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 10,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleAccept}
          style={{
            flex: 1,
            marginLeft: 10,
            height: 50,
            borderRadius: 10,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#8B1E3F",
          }}
        >
          <Text style={{ color: "#fff" }}>Choose</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

import React, { useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../constants";
import { getQrCode } from "../services/api/qr.service";
import { useSelector } from "react-redux";
const HeaderBackButton = ({ onPress }) => (
  <TouchableOpacity onPress={onPress}>
    <Entypo
      name="chevron-left"
      size={SIZES.xxxLarge - 5}
      color={COLORS.primary}
    />
  </TouchableOpacity>
);

const MyQrCode = () => {
  const navigation = useNavigation();
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);

  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );

  /* ---------- Fetch QR Code ---------- */
  useEffect(() => {
    if (!employeeCode) return;

    let isMounted = true;

    const fetchQr = async () => {
      try {
        const data = await getQrCode(employeeCode);
        if (isMounted) {
          setQrData(data);
        }
      } catch (error) {
        console.error("❌ Failed to fetch QR code:", error.message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchQr();

    return () => {
      isMounted = false;
    };
  }, [employeeCode]);

  /* ---------- Header ---------- */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: "My QR Code",
      headerTitleAlign: "center",
      headerShadowVisible: false,
      headerLeft: () => <HeaderBackButton onPress={navigation.goBack} />,
    });
  }, [navigation]);

  return (
    <ScrollView className="flex-1 bg-gray-50 px-4 pt-4">
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} />
      ) : (
        <View className="bg-white rounded-2xl p-5 border border-gray-200 items-center">
          {/* QR Image */}
          {qrData?.imageUrl ? (
            <Image
              source={{ uri: qrData.imageUrl }}
              style={{ width: 220, height: 220 }}
              resizeMode="contain"
            />
          ) : (
            <Text className="text-red-500">QR Code not available</Text>
          )}

          {/* Employee Code */}
          <View className="mt-4 flex-row items-center">
            <Ionicons
              name="person-outline"
              size={SIZES.xLarge}
              color={COLORS.primary}
            />
            <Text className="ml-2 text-base font-semibold text-gray-900">
              {qrData?.employee || "—"}
            </Text>
          </View>
        </View>
      )}

      {/* Footer */}
      <View className="mt-8 mb-4 pt-3 border-t border-gray-200 flex-row justify-end">
        <TouchableOpacity
          onPress={() => Linking.openURL("https://erpgulf.com")}
        >
          <Text className="text-lg font-semibold text-green-600">
            ERPGulf.com
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

export default MyQrCode;

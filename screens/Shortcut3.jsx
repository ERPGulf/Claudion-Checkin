import React, { useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import Entypo from "@expo/vector-icons/Entypo";
import { getShortcut3 } from "../services/api/records.service";
import { COLORS, SIZES } from "../constants";

/**
 * Format backend keys into readable labels
 * passport_number -> Passport Number
 */
const formatLabel = (key) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const Shortcut3 = () => {
  const navigation = useNavigation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shortcutTitle, setShortcutTitle] = useState("");

  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );
// Fetch data
  useEffect(() => {
    if (!employeeCode) return;

    const fetchData = async () => {
      try {
        const result = await getShortcut3(employeeCode);
        console.log("API result:", result);

        setData(result?.data || {});
        setShortcutTitle(formatLabel(result?.shortcut || "Records"));
      } catch (err) {
        console.error("Error fetching shortcut data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [employeeCode]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: shortcutTitle,
      headerTitleAlign: "center",
      headerShadowVisible: false,
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
  }, [navigation, shortcutTitle]);

  /* ---------------- Loading UI ---------------- */
  if (loading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text className="mt-2 text-gray-500">Loading details...</Text>
      </View>
    );
  }

  /* ---------------- Empty UI ---------------- */
  if (!data) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-gray-500 text-sm">No records available</Text>
      </View>
    );
  }

  /* ---------------- Main UI ---------------- */
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View
        className="bg-white rounded-xl px-4 py-3"
        style={{
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 6,
          elevation: 3,
        }}
      >
        {Object.entries(data)
          .filter(([_, value]) => value !== null && value !== undefined)
          .map(([key, value], index, arr) => (
            <View key={key}>
              <View className="flex-row justify-between items-center py-3">
                <Text className="text-sm text-gray-500">
                  {formatLabel(key)}
                </Text>

                <Text className="text-sm font-semibold text-gray-800">
                  {String(value)}
                </Text>
              </View>

              {/* Divider */}
              {index !== arr.length - 1 && (
                <View className="h-[1px] bg-gray-100" />
              )}
            </View>
          ))}
      </View>
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

export default Shortcut3;

import React, { useLayoutEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../../constants";

const formatLabel = (key = "") =>
  key
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const ShortcutDetails = ({ title, data, loading }) => {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: title,
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
  }, [navigation, title]);

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text className="mt-2 text-gray-500">Loading details...</Text>
      </View>
    );
  }

  /* ---------- Empty ---------- */
  const hasValidData =
    data &&
    Object.values(data).some((v) => v !== null && v !== undefined && v !== "");

  if (!hasValidData) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-gray-500 text-sm">No records available</Text>
      </View>
    );
  }

  /* ---------- Main UI ---------- */
  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
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
    </View>
  );
};

export default ShortcutDetails;

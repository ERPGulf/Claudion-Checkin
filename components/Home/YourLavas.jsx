import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
} from "react-native";
import { useSelector } from "react-redux";
import {
  Ionicons,
  AntDesign,
  Octicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../../constants";
import {
  getShortcut1,
  getShortcut2,
  getShortcut3,
} from "../../services/api/records.service";

function LavaMenu() {
  const navigation = useNavigation();
  const [shortcuts, setShortcuts] = useState([]);
  const [loadingShortcuts, setLoadingShortcuts] = useState(true);

  // Safe access to employeeCode from Redux
  const employeeCode = useSelector((state) =>
    state.user && state.user.userDetails
      ? state.user.userDetails.employeeCode
      : null
  );

  // Fetch dynamic shortcuts for "Your Records"
  useEffect(() => {
    if (!employeeCode) return;

    const fetchShortcuts = async () => {
      setLoadingShortcuts(true);

      const requests = [
        getShortcut1(employeeCode),
        getShortcut2(employeeCode),
        getShortcut3(employeeCode),
      ];

      const responses = await Promise.allSettled(requests);

      const configs = [
        { screen: "Shortcut1", icon: "medkit-outline" },
        { screen: "Shortcut2", icon: "id-card-outline" },
        { screen: "Shortcut3", icon: "person-outline" },
      ];

      const results = responses
        .map((res, index) =>
          res.status === "fulfilled" && res.value?.shortcut
            ? { ...res.value, ...configs[index] }
            : null
        )
        .filter(Boolean);

      setShortcuts(results);
      setLoadingShortcuts(false);
    };

    fetchShortcuts();
  }, [employeeCode]);

  return (
    // first row
    <View className="my-2" style={{ width: "100%" }}>
      <View>
        <Text className="text-sm font-semibold">Menu</Text>
      </View>
      <View className="my-2">
        <View
          className="flex-row justify-between items-center py-2.5 px-3 rounded-t-xl"
          style={{ width: "100%", backgroundColor: COLORS.primary }}
        >
          <View>
            <Octicons name="people" size={SIZES.xxLarge + 4} color="white" />
          </View>
          <Text className="text-lg font-medium text-white text-center ">
            Human Resources
          </Text>
          <TouchableOpacity className="justify-center items-center rounded-lg">
            <AntDesign
              name="right"
              size={SIZES.xxLarge + 4}
              color={COLORS.white}
            />
          </TouchableOpacity>
        </View>
        <View className="bg-white rounded-b-xl py-3 px-2 mb-2">
          <ScrollView
            showsHorizontalScrollIndicator={false}
            horizontal
            contentContainerStyle={{
              flexGrow: 1,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                navigation.navigate("Attendance action");
              }}
              className="mr-4"
            >
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16">
                <Ionicons
                  name="calendar-outline"
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                Attendance
              </Text>
              <Text className="text-xs text-center font-medium text-gray-500">
                action
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="mr-4"
              onPress={() => {
                navigation.navigate("Attendance history");
              }}
            >
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16">
                <Ionicons
                  name="receipt-outline"
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                Attendance
              </Text>
              <Text className="text-xs text-center font-medium text-gray-500">
                history
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="mr-4"
              onPress={() => navigation.navigate("Expense claim")}
            >
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16">
                <Ionicons
                  name="wallet-outline"
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                Expense
              </Text>
              <Text className="text-xs text-center font-medium text-gray-500">
                claim
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="mr-4"
              onPress={() => {
                navigation.navigate("Leave request");
              }}
            >
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16 shadow-sm">
                <Ionicons
                  name="document-text-outline"
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-semibold text-gray-700 mt-1">
                Leave
              </Text>
              <Text className="text-xs text-center font-semibold text-gray-700">
                Request
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                navigation.navigate("comingsoon");
              }}
            >
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16">
                <Ionicons
                  name="list-outline"
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                Vacation
              </Text>
              <Text className="text-xs text-center font-medium text-gray-500">
                list
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
      {/* second row */}

      <View className="mb-4">
        {/* Header */}
        <View
          className="flex-row justify-between items-center py-2.5 px-3 rounded-t-xl"
          style={{ width: "100%", backgroundColor: COLORS.primary }}
        >
          <MaterialCommunityIcons
            name="card-account-details"
            size={SIZES.xxLarge + 4}
            color="white"
          />

          <Text className="text-lg font-medium text-white text-center">
            Your Records In The Company
          </Text>

          <AntDesign
            name="right"
            size={SIZES.xxLarge + 4}
            color={COLORS.white}
          />
        </View>

        {/* Buttons */}
        <View className="flex-row bg-white flex-wrap py-4 items-center px-2 rounded-b-xl">
          {/* 🔹 Skeleton while shortcuts load */}
          {loadingShortcuts && (
            <View className="flex-row px-2 py-4">
              {[1, 2, 3].map((_, i) => (
                <View key={i} className="w-16 mr-4 items-center">
                  <View className="bg-gray-200 h-14 w-14 rounded-lg" />
                  <View className="h-8 mt-1 bg-gray-200 w-14 rounded" />
                </View>
              ))}
            </View>
          )}
          {shortcuts.map((shortcut, index) => (
            <TouchableOpacity
              key={index}
              className="w-16 mr-4"
              onPress={() =>
                navigation.navigate(shortcut.screen, {
                  shortcutData: shortcut.data,
                  title: shortcut.shortcut,
                })
              }
            >
              <View className="items-center mt-3">
                {/* FIXED icon box */}
                <View className="bg-gray-100 h-14 w-14 justify-center items-center rounded-lg">
                  <Ionicons
                    name={shortcut.icon}
                    size={SIZES.xxxLarge - 6}
                    color={COLORS.primary}
                  />
                </View>

                {/* FIXED text space */}
                <View className="h-8 mt-1 justify-center">
                  <Text
                    className="text-xs text-center font-medium text-gray-500"
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {shortcut.shortcut?.replace(/_/g, " ") || ""}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            className="w-16 mr-4"
            onPress={() => navigation.navigate("My QR Code")}
          >
            <View className="items-center mt-3">
              <View className="bg-gray-100 h-14 w-14 justify-center items-center rounded-lg">
                <Ionicons
                  name="qr-code"
                  size={SIZES.xxxLarge - 6}
                  color={COLORS.primary}
                />
              </View>

              <View className="min-h-[32px] mt-1 justify-center">
                <Text className="text-xs text-center font-medium text-gray-500">
                  My QR
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View
        className="flex-row items-center justify-between px-4 py-3 rounded-xl"
        style={{ backgroundColor: COLORS.primary }}
      >
        <Ionicons name="globe-outline" size={SIZES.xxLarge} color="#fff" />

        <TouchableOpacity
          onPress={() => Linking.openURL("https://erpgulf.com")}
          className="flex-row items-center"
          activeOpacity={0.7}
        >
          <Text className="text-lg font-semibold text-white mr-1">
            ERPGulf.com
          </Text>
          <Ionicons name="open-outline" size={16} color="#fff" />
        </TouchableOpacity>

        <View style={{ width: SIZES.xxLarge }} />
      </View>
    </View>
  );
}

export default LavaMenu;

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
      try {
        const results = [];
        // Shortcut 1
        const res1 = await getShortcut1(employeeCode);
        if (res1) {
          results.push({
            ...res1,
            screen: "Shortcut1", // 👈 where to navigate
            icon: "medkit-outline",
          });
        }

        // Shortcut 2
        const res2 = await getShortcut2(employeeCode);
        if (res2) {
          results.push({
            ...res2,
            screen: "Shortcut2", // 👈 where to navigate
            icon: "id-card-outline",
          });
        }

        // Shortcut 3
        const res3 = await getShortcut3(employeeCode);
        if (res3) {
          results.push({
            ...res3,
            screen: "Shortcut3",
            icon: "business-outline",
          });
        }

        setShortcuts(results);
      } catch (err) {
        console.error("Error fetching shortcuts:", err);
      }
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
        {/* Buttons */}
        <View className="flex-row bg-white flex-wrap py-4 items-center px-2 rounded-b-xl">
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
              <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16 mt-3">
                <Ionicons
                  name={shortcut.icon}
                  size={SIZES.xxxLarge - 3}
                  color={COLORS.primary}
                />
              </View>

              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                {shortcut.shortcut.replace(/_/g, " ")}
              </Text>
            </TouchableOpacity>
          ))}

          {/* ✅ My QR inside same row */}
          <TouchableOpacity
            className="w-16 mr-4"
            onPress={() => navigation.navigate("My QR Code")}
          >
            <View className="bg-gray-100 p-2 justify-center items-center rounded-lg w-16 -mt-5">
              <Ionicons
                name="qr-code"
                size={SIZES.xxxLarge - 3}
                color={COLORS.primary}
              />
            </View>

            <Text className="text-xs text-center font-medium text-gray-500 mt-1">
              My QR
            </Text>
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

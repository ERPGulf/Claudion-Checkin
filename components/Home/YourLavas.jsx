import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
} from "react-native";

import { useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

const SHORTCUT_CACHE_KEY = "user_shortcuts_cache_v2";

/* ---------------------------------------------------
 * Memoized Shortcut Button (prevents re-render)
 * --------------------------------------------------- */
const ShortcutButton = React.memo(({ shortcut, navigation }) => {
  return (
    <TouchableOpacity
      className="w-16 mr-4"
      onPress={() =>
        navigation.navigate(shortcut.screen, {
          shortcutData: shortcut.data,
          title: shortcut.shortcut,
        })
      }
    >
      <View className="items-center mt-3">
        {/* Icon */}
        <View className="bg-gray-100 h-14 w-14 justify-center items-center rounded-lg">
          <Ionicons
            name={shortcut.icon}
            size={SIZES.xxxLarge - 6}
            color={COLORS.primary}
          />
        </View>

        {/* Text */}
        <View className="mt-1 px-1">
          <Text className="text-xs text-center font-medium text-gray-500">
            {shortcut.shortcut?.replace(/_/g, " ")}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

/* ---------------------------------------------------
 * Main Component
 * --------------------------------------------------- */
function LavaMenu() {
  const navigation = useNavigation();
  const [shortcuts, setShortcuts] = useState([]);
  const [loadingShortcuts, setLoadingShortcuts] = useState(true);

  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );

  /* ---------------------------------------------------
   * Load cached shortcuts immediately
   * --------------------------------------------------- */
  useEffect(() => {
    const loadCachedShortcuts = async () => {
      try {
        const cached = await AsyncStorage.getItem(SHORTCUT_CACHE_KEY);
        if (cached) {
          setShortcuts(JSON.parse(cached));
          setLoadingShortcuts(false);
        }
      } catch (e) {
        console.log("Failed to load shortcut cache", e);
      }
    };

    loadCachedShortcuts();
  }, []);

  /* ---------------------------------------------------
   * Fetch shortcuts incrementally (no blocking)
   * --------------------------------------------------- */
  useEffect(() => {
    if (!employeeCode) return;

    const configs = [
      {
        api: getShortcut1,
        screen: "Shortcut1",
        icon: "folder-outline",
        order: 1,
      },
      {
        api: getShortcut2,
        screen: "Shortcut2",
        icon: "documents-outline",
        order: 2,
      },
      {
        api: getShortcut3,
        screen: "Shortcut3",
        icon: "document-text-outline",
        order: 3,
      },
    ];

    configs.forEach(async (cfg) => {
      try {
        const res = await cfg.api(employeeCode);
        if (res?.shortcut) {
          setShortcuts((prev) => {
            const filtered = prev.filter((item) => item.screen !== cfg.screen);

            const updated = [...filtered, { ...res, ...cfg }].sort(
              (a, b) => a.order - b.order
            );

            AsyncStorage.setItem(SHORTCUT_CACHE_KEY, JSON.stringify(updated));

            return updated;
          });
        }
      } catch (e) {
        console.log("Shortcut API error", e);
      }
    });
  }, [employeeCode]);

  return (
    <View className="my-2" style={{ width: "100%" }}>
      {/* -------------------- HEADER -------------------- */}
      <Text className="text-sm font-semibold mb-2">Menu</Text>

      {/* -------------------- HR SECTION -------------------- */}
      <View>
        <View
          className="flex-row justify-between items-center py-2.5 px-3 rounded-t-xl"
          style={{ backgroundColor: COLORS.primary }}
        >
          <Octicons name="people" size={SIZES.xxLarge + 4} color="#fff" />
          <Text className="text-lg font-medium text-white">
            Human Resources
          </Text>
          <AntDesign name="right" size={SIZES.xxLarge + 4} color="#fff" />
        </View>

        <View className="bg-white rounded-b-xl py-3 px-2 mb-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {[
              {
                label: ["Attendance", "action"],
                icon: "calendar-outline",
                nav: "Attendance action",
              },
              {
                label: ["Attendance", "history"],
                icon: "receipt-outline",
                nav: "Attendance history",
              },
              {
                label: ["Expense", "claim"],
                icon: "wallet-outline",
                nav: "Expense claim",
              },
              {
                label: ["Leave", "Request"],
                icon: "document-text-outline",
                nav: "Leave request",
                bold: true,
              },
              {
                label: ["Vacation", "list"],
                icon: "list-outline",
                nav: "comingsoon", // or your actual screen name
              },
            ].map((item, index) => (
              <TouchableOpacity
                key={index}
                className="mr-4"
                onPress={() => navigation.navigate(item.nav)}
              >
                <View className="bg-gray-100 p-2 items-center rounded-lg w-16">
                  <Ionicons
                    name={item.icon}
                    size={SIZES.xxxLarge - 3}
                    color={COLORS.primary}
                  />
                </View>
                {item.label.map((t, i) => (
                  <Text
                    key={i}
                    className={`text-xs text-center mt-1 ${
                      item.bold
                        ? "font-semibold text-gray-700"
                        : "font-medium text-gray-500"
                    }`}
                  >
                    {t}
                  </Text>
                ))}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* -------------------- YOUR RECORDS -------------------- */}
      <View>
        <View
          className="flex-row justify-between items-center py-2.5 px-3 rounded-t-xl"
          style={{ backgroundColor: COLORS.primary }}
        >
          <MaterialCommunityIcons
            name="card-account-details"
            size={SIZES.xxLarge + 4}
            color="#fff"
          />
          <Text className="text-lg font-medium text-white">
            Your Records In The Company
          </Text>
          <AntDesign name="right" size={SIZES.xxLarge + 4} color="#fff" />
        </View>

        <View className="flex-row bg-white flex-wrap py-4 px-2 rounded-b-xl">
          {/* Skeleton */}
          {loadingShortcuts && shortcuts.length === 0 && (
            <View className="flex-row px-2">
              {[1, 2, 3].map((i) => (
                <View key={i} className="w-16 mr-4 items-center">
                  <View className="bg-gray-200 h-14 w-14 rounded-lg" />
                  <View className="h-8 mt-1 bg-gray-200 w-14 rounded" />
                </View>
              ))}
            </View>
          )}

          {/* Dynamic shortcuts */}
          {shortcuts.map((shortcut) => (
            <ShortcutButton
              key={shortcut.shortcut}
              shortcut={shortcut}
              navigation={navigation}
            />
          ))}

          {/* Static QR */}
          <TouchableOpacity
            className="w-16 mr-4"
            onPress={() => navigation.navigate("My QR Code")}
          >
            <View className="items-center mt-3">
              <View className="bg-gray-100 h-14 w-14 items-center justify-center rounded-lg">
                <Ionicons
                  name="qr-code"
                  size={SIZES.xxxLarge - 6}
                  color={COLORS.primary}
                />
              </View>
              <Text className="text-xs text-center font-medium text-gray-500 mt-1">
                My QR
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* -------------------- FOOTER LINK -------------------- */}
      <View
        className="flex-row items-center justify-between px-4 py-3 rounded-xl mt-3"
        style={{ backgroundColor: COLORS.primary }}
      >
        <Ionicons name="globe-outline" size={SIZES.xxLarge} color="#fff" />

        <TouchableOpacity
          onPress={() => Linking.openURL("https://erpgulf.com")}
          className="flex-row items-center"
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

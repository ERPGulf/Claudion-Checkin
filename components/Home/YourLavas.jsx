/* eslint-disable react/prop-types */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
} from "react-native";
import AttendanceHistory from "../../assets/images/AttendanceHistory.svg";
import ComplaintIcon from "../../assets/images/complaint.svg";
import ExpenseIcon from "../../assets/images/expense.svg";
import LeaveIcon from "../../assets/images/leave.svg";
import HealthCardIcon from "../../assets/images/healthCard.svg";
import IdCardIcon from "../../assets/images/idCard.svg";
import PassportIcon from "../../assets/images/passport.svg";
import QrCodeIcon from "../../assets/images/qrCode.svg";
import { LinearGradient } from "expo-linear-gradient";
/* ---------------- DEFAULT FALLBACK RECORDS ---------------- */
const DEFAULT_RECORDS = [
  {
    shortcut: "Record 1",
    icon: "document-outline",
    isFallback: true,
  },
  {
    shortcut: "Record 2",
    icon: "folder-outline",
    isFallback: true,
  },
  {
    shortcut: "Record 3",
    icon: "document-text-outline",
    isFallback: true,
  },
];
const items = [
  {
    title: "Attendance\nHistory",
    component: AttendanceHistory,
    nav: "Attendance history",
  },
  {
    title: "Leave\nRequest",
    component: LeaveIcon,
    nav: "Leave request",
  },
  {
    title: "Expense\nClaim",
    component: ExpenseIcon,
    nav: "Expense claim",
  },
  {
    title: "Complaint",
    component: ComplaintIcon,
    nav: "Complaints",
  },
];
const documentItems = [
  {
    title: "Health\nCard",
    component: HealthCardIcon,
    nav: "Health Card",
  },
  {
    title: "Residence\nCard",
    component: IdCardIcon,
    nav: "Residence Card",
  },
  {
    title: "Passport",
    component: PassportIcon,
    nav: "Passport",
  },
  {
    title: "QR Code",
    component: QrCodeIcon,
    nav: "My QR Code",
  },
];
/* ---------------------------------------------------------- */

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
  const handlePress = () => {
    // 🛑 Fallback record → NO navigation
    if (shortcut.isFallback) {
      alert("No records available");
      return;
    }

    // ✅ Real shortcut → navigate
    if (shortcut.screen) {
      navigation.navigate(shortcut.screen, {
        shortcutData: shortcut.data,
        title: shortcut.shortcut,
      });
    }
  };

  return (
    <TouchableOpacity className="w-16 mr-4" onPress={handlePress}>
      <View className="items-center mt-3">
        <View className="bg-gray-100 h-14 w-14 justify-center items-center rounded-lg">
          <Ionicons
            name={shortcut.icon}
            size={SIZES.xxxLarge - 6}
            color={COLORS.primary}
          />
        </View>

        <View className="mt-1 px-1">
          <Text className="text-xs text-center font-medium text-gray-500">
            {shortcut.shortcut}
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
    (state) => state.user?.userDetails?.employeeCode,
  );
  const recordsToShow =
    !loadingShortcuts && shortcuts.length === 0 ? DEFAULT_RECORDS : shortcuts;

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
      } catch (e) {}
    };

    loadCachedShortcuts();
  }, []);

  /* ---------------------------------------------------
   * Fetch shortcuts incrementally (no blocking)
   * --------------------------------------------------- */
  // useEffect(() => {
  //   if (!employeeCode) return;

  //   const configs = [
  //     {
  //       api: getShortcut1,
  //       screen: "Shortcut1",
  //       icon: "folder-outline",
  //       order: 1,
  //     },
  //     {
  //       api: getShortcut2,
  //       screen: "Shortcut2",
  //       icon: "documents-outline",
  //       order: 2,
  //     },
  //     {
  //       api: getShortcut3,
  //       screen: "Shortcut3",
  //       icon: "document-text-outline",
  //       order: 3,
  //     },
  //   ];

  //   Promise.all(
  //     configs.map(async (cfg) => {
  //       try {
  //         const res = await cfg.api(employeeCode);
  //         if (res?.shortcut) {
  //           setShortcuts((prev) => {
  //             const filtered = prev.filter(
  //               (item) => item.screen !== cfg.screen,
  //             );

  //             return [...filtered, { ...res, ...cfg }].sort(
  //               (a, b) => a.order - b.order,
  //             );
  //           });
  //         }
  //       } catch (e) {}
  //     }),
  //   ).finally(() => {
  //     // ✅ THIS LINE WAS MISSING
  //     setLoadingShortcuts(false);
  //   });
  // }, [employeeCode]);

  return (
    <View style={{ marginVertical: 8, width: "100%", alignSelf: "center" }}>
      {/* -------------------- HR SECTION -------------------- */}
      <View style={{ marginTop: 4 }}>
        {/* Title */}
        <View style={{ marginTop: 13 }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: "600",
              color: "#63205F",
            }}
          >
            HR Services
          </Text>
        </View>

        {/* Card */}
        <View
          style={{
            marginTop: 13,
            backgroundColor: "#fff",
            borderRadius: 7,
            borderWidth: 1,
            borderColor: "#B3B3B3",
            padding: 12,
            height: 151,
            alignSelf: "stretch",

            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 8,
            elevation: 2,

            justifyContent: "space-between",
          }}
        >
          {/* -------- GRID -------- */}
          <View style={{ height: 90 }}>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "space-between",
                paddingHorizontal: 4,
              }}
            >
              {items.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={{
                    width: "22%",
                    alignItems: "center",
                  }}
                  onPress={() => navigation.navigate(item.nav)}
                >
                  {/* Icon */}
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 7,
                      borderWidth: 1,
                      borderColor: "#63205F",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#FFEEFE",
                    }}
                  >
                    <item.component width={36} height={36} />
                  </View>

                  {/* Title */}
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 5,
                      color: "#333",
                      fontWeight: "500",
                      height: 30,
                    }}
                  >
                    {item.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* -------- BUTTON -------- */}
          <TouchableOpacity activeOpacity={0.8}>
            <LinearGradient
              colors={["#77224C", "#8E273B"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                height: 47,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
                marginHorizontal: -12,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontWeight: "600",
                  fontSize: 16,
                }}
              >
                View All
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* -------------------- YOUR RECORDS -------------------- */}
        <View className="mt-4">
          {/* Title */}
          <View style={{ marginTop: 13 }}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "600",
                color: "#63205F",
              }}
            >
              Employee Documents
            </Text>
          </View>

          {/* Card */}
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 7,
              borderWidth: 1,
              borderColor: "#B3B3B3",
              padding: 12,
              marginTop: 13,
              height: 115,
              alignSelf: "stretch",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              elevation: 2,
            }}
          >
            {/* Grid */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "space-between",
                paddingHorizontal: 4,
              }}
            >
              {documentItems.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={{ width: "22%", alignItems: "center" }}
                  onPress={() => navigation.navigate(item.nav)}
                >
                  <View
                    style={{
                      width: 55,
                      height: 55,
                      borderRadius: 7,
                      borderWidth: 1,
                      borderColor: "#6B1E6B",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#FFEEFE",
                    }}
                  >
                    <item.component width={40} height={40} />
                  </View>

                  <Text
                    style={{
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 5,
                      color: "#333",
                      fontWeight: "500",
                      height: 30,
                    }}
                  >
                    {item.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export default LavaMenu;

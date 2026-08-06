/* eslint-disable react/prop-types */
import React, { useEffect, useState } from "react";
import { View, Text, Linking } from "react-native";
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

/* ---------------------------------------------------------- */

import { useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { ICON, RADIUS, SPACING, TYPO } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import {
  getShortcut1,
  getShortcut2,
  getShortcut3,
} from "../../services/api/records.service";
import SectionHeader from "../common/SectionHeader";
import ModuleCard from "../common/ModuleCard";
import FeatureTile from "../common/FeatureTile";
import PressableScale from "../common/PressableScale";

const SHORTCUT_CACHE_KEY = "user_shortcuts_cache_v2";

/** Tiles per row. 4 keeps every label readable at 11pt on a 360dp screen. */
const COLUMNS = 4;

/**
 * HR features. Labels are single strings — <FeatureTile> wraps them onto two
 * lines itself, so they no longer have to be hand-split. `nav` targets are
 * unchanged and must keep matching the route names in app-navigator.jsx.
 *
 * Two conventions, both enforced by __tests__/featureLabels.test.js:
 *  - Sentence case, so the grid reads as one list rather than a mix of styles.
 *  - No per-item weight overrides. Two entries used to be flagged for heavier
 *    text, which rendered them darker than their neighbours with nothing to
 *    explain why — it read as a rendering bug, not as emphasis.
 */
export const HR_FEATURES = [
  {
    label: "Attendance action",
    icon: "calendar-outline",
    nav: "Attendance action",
  },
  {
    label: "Attendance history",
    icon: "receipt-outline",
    nav: "Attendance history",
  },
  {
    label: "Attendance request",
    icon: "clipboard-outline",
    nav: "Attendance request",
  },
  {
    label: "Automatic attendance",
    icon: "location-outline",
    nav: "Auto attendance",
  },
  {
    label: "Expense claim",
    icon: "wallet-outline",
    nav: "Expense claim",
  },
  {
    label: "Leave request",
    icon: "document-text-outline",
    nav: "Leave request",
  },
  // {
  //   label: "Salary advance",
  //   icon: "card-outline",
  //   nav: "Salary advance",
  // },
  {
    label: "Loan application",
    icon: "card-outline",
    nav: "Loan application",
  },
  {
    label: "Complaints",
    icon: "chatbox-ellipses-outline",
    nav: "Complaints",
  },
];

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
    <FeatureTile
      icon={shortcut.icon}
      label={shortcut.shortcut}
      columns={COLUMNS}
      onPress={handlePress}
    />
  );
});

/** Placeholder tiles that match the real grid geometry, so nothing shifts. */
function ShortcutSkeleton() {
  const { colors } = useAppTheme();

  return (
    <>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            width: `${100 / COLUMNS}%`,
            paddingHorizontal: SPACING.xs,
            marginBottom: SPACING.md,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: RADIUS.lg,
              backgroundColor: colors.skeleton,
            }}
          />
          <View
            style={{
              width: 44,
              height: 10,
              borderRadius: RADIUS.sm,
              backgroundColor: colors.skeleton,
              marginTop: SPACING.sm,
            }}
          />
        </View>
      ))}
    </>
  );
}

/* ---------------------------------------------------
 * Main Component
 * --------------------------------------------------- */
function LavaMenu() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
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

    Promise.all(
      configs.map(async (cfg) => {
        try {
          const res = await cfg.api(employeeCode);
          if (res?.shortcut) {
            setShortcuts((prev) => {
              const filtered = prev.filter(
                (item) => item.screen !== cfg.screen,
              );

              return [...filtered, { ...res, ...cfg }].sort(
                (a, b) => a.order - b.order,
              );
            });
          }
        } catch (e) {}
      }),
    ).finally(() => {
      // ✅ THIS LINE WAS MISSING
      setLoadingShortcuts(false);
    });
  }, [employeeCode]);

  return (
    <View style={{ width: "100%" }}>
      {/* -------------------- HEADER -------------------- */}
      <SectionHeader title="Menu" />

      {/* -------------------- HR SECTION -------------------- */}
      <ModuleCard
        icon="people"
        iconFamily="Octicons"
        title="Human Resources"
        subtitle="Attendance, leave, claims"
        style={{ marginBottom: SPACING.lg }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {HR_FEATURES.map((item) => (
            <FeatureTile
              key={item.nav + item.label}
              icon={item.icon}
              label={item.label}
              columns={COLUMNS}
              onPress={() => navigation.navigate(item.nav)}
            />
          ))}
        </View>
      </ModuleCard>

      {/* -------------------- YOUR RECORDS -------------------- */}
      <ModuleCard
        icon="card-account-details-outline"
        iconFamily="MaterialCommunityIcons"
        title="Your Records"
        subtitle="Documents held by the company"
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {/* Skeleton */}
          {loadingShortcuts && shortcuts.length === 0 && <ShortcutSkeleton />}

          {/* Dynamic shortcuts */}
          {recordsToShow.map((shortcut, index) => (
            <ShortcutButton
              key={shortcut.shortcut || index}
              shortcut={shortcut}
              navigation={navigation}
            />
          ))}

          {/* Static QR */}
          <FeatureTile
            icon="qr-code-outline"
            label="My QR"
            columns={COLUMNS}
            onPress={() => navigation.navigate("My QR Code")}
          />
        </View>
      </ModuleCard>

      {/* -------------------- FOOTER LINK -------------------- */}
      <PressableScale
        onPress={() => Linking.openURL("https://erpgulf.com")}
        accessibilityLabel="Open ERPGulf.com"
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: SPACING.lg,
          marginTop: SPACING.sm,
        }}
      >
        <Ionicons
          name="globe-outline"
          size={ICON.sm}
          color={colors.textMuted}
        />
        <Text
          style={{
            ...TYPO.subhead,
            color: colors.textMuted,
            marginHorizontal: SPACING.sm,
          }}
        >
          ERPGulf.com
        </Text>
        <Ionicons name="open-outline" size={13} color={colors.textMuted} />
      </PressableScale>
    </View>
  );
}

export default LavaMenu;

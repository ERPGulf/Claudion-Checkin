/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AntDesign,
  Ionicons,
  MaterialCommunityIcons,
  Octicons,
} from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../../constants";
import {
  getShortcut1,
  getShortcut2,
  getShortcut3,
} from "../../services/api/records.service";

const SHORTCUT_CACHE_KEY = "user_shortcuts_cache_v2";

const SHORTCUT_CONFIGS = [
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

const HR_MENU_ITEMS = [
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
    label: ["Attendance", "Request"],
    icon: "clipboard-outline",
    nav: "Attendance request",
    bold: true,
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
    label: ["Complaints"],
    icon: "chatbox-ellipses-outline",
    nav: "Complaints",
  },
  {
    label: ["Vacation", "list"],
    icon: "list-outline",
    nav: "comingsoon",
  },
];

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

const ShortcutButton = React.memo(
  ({ shortcut, navigation, tileWidth, iconBoxSize, iconSize, brandColor }) => {
    const handlePress = () => {
      if (shortcut.isFallback) {
        Alert.alert("No records available");
        return;
      }

      if (shortcut.screen) {
        navigation.navigate(shortcut.screen, {
          shortcutData: shortcut.data,
          title: shortcut.shortcut,
        });
      }
    };

    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.tileButton,
          { width: tileWidth },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.tileInner}>
          <View
            style={[
              styles.tileIconWrap,
              {
                width: iconBoxSize,
                height: iconBoxSize,
                borderRadius: 14,
              },
            ]}
          >
            <Ionicons name={shortcut.icon} size={iconSize} color={brandColor} />
          </View>

          <View style={styles.tileTextWrap}>
            <Text numberOfLines={2} style={styles.shortcutText}>
              {shortcut.shortcut}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  },
);

const HrButton = React.memo(
  ({ item, navigation, tileWidth, iconBoxSize, iconSize, brandColor }) => (
    <Pressable
      onPress={() => navigation.navigate(item.nav)}
      style={({ pressed }) => [
        styles.tileButton,
        { width: tileWidth },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.tileInner}>
        <View
          style={[
            styles.tileIconWrap,
            {
              width: iconBoxSize,
              height: iconBoxSize,
              borderRadius: 14,
            },
          ]}
        >
          <Ionicons name={item.icon} size={iconSize + 1} color={brandColor} />
        </View>

        <View style={styles.tileTextWrap}>
          {item.label.map((labelPart, index) => (
            <Text
              key={`${item.nav}-${labelPart}`}
              numberOfLines={1}
              style={[
                styles.menuText,
                item.bold && styles.menuTextBold,
                index > 0 && styles.menuTextSecondLine,
              ]}
            >
              {labelPart}
            </Text>
          ))}
        </View>
      </View>
    </Pressable>
  ),
);

function LavaMenu() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const [shortcuts, setShortcuts] = useState([]);
  const [loadingShortcuts, setLoadingShortcuts] = useState(true);

  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode,
  );

  const isTablet = width >= 768;
  const isSmall = width < 360;
  const tileWidth = isTablet ? 84 : isSmall ? 66 : 72;
  const iconBoxSize = isTablet ? 66 : isSmall ? 50 : 56;
  const iconSize = isTablet ? 30 : isSmall ? 22 : SIZES.xxxLarge - 6;
  const brandColor = COLORS.brandPrimary || COLORS.primary;

  const recordsToShow = useMemo(
    () =>
      !loadingShortcuts && shortcuts.length === 0 ? DEFAULT_RECORDS : shortcuts,
    [loadingShortcuts, shortcuts],
  );

  useEffect(() => {
    let isActive = true;

    const loadCachedShortcuts = async () => {
      try {
        const cached = await AsyncStorage.getItem(SHORTCUT_CACHE_KEY);
        if (!cached || !isActive) {
          return;
        }

        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setShortcuts(parsed);
          setLoadingShortcuts(false);
        }
      } catch (e) {}
    };

    loadCachedShortcuts();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const fetchShortcuts = async () => {
      if (!employeeCode) {
        if (isActive) {
          setLoadingShortcuts(false);
        }
        return;
      }

      try {
        const responses = await Promise.allSettled(
          SHORTCUT_CONFIGS.map(async (cfg) => {
            const res = await cfg.api(employeeCode);
            return res?.shortcut ? { ...res, ...cfg } : null;
          }),
        );

        if (!isActive) {
          return;
        }

        const fetchedShortcuts = responses
          .filter((item) => item.status === "fulfilled" && item.value?.shortcut)
          .map((item) => item.value)
          .sort((a, b) => a.order - b.order);

        if (fetchedShortcuts.length > 0) {
          setShortcuts((prev) => {
            const byScreen = new Map();

            prev.forEach((item) => {
              if (item?.screen) {
                byScreen.set(item.screen, item);
              }
            });

            fetchedShortcuts.forEach((item) => {
              byScreen.set(item.screen, item);
            });

            return Array.from(byScreen.values()).sort(
              (a, b) => (a.order || 99) - (b.order || 99),
            );
          });

          AsyncStorage.setItem(
            SHORTCUT_CACHE_KEY,
            JSON.stringify(fetchedShortcuts),
          ).catch(() => {});
        }
      } catch (e) {
      } finally {
        if (isActive) {
          setLoadingShortcuts(false);
        }
      }
    };

    fetchShortcuts();

    return () => {
      isActive = false;
    };
  }, [employeeCode]);

  const openWebsite = useCallback(async () => {
    const url = "https://erpgulf.com";

    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (e) {}
  }, []);

  return (
    <View style={styles.container}>
      <Text style={[styles.menuLabel, isTablet && styles.menuLabelTablet]}>
        Menu
      </Text>

      <View style={styles.sectionCard}>
        <View style={[styles.sectionHeader, { backgroundColor: brandColor }]}>
          <View style={styles.sectionIconBubble}>
            <Octicons name="people" size={SIZES.xxLarge} color={COLORS.white} />
          </View>
          <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
            Human Resources
          </Text>
          <View style={styles.sectionIconBubble}>
            <AntDesign name="right" size={18} color={COLORS.white} />
          </View>
        </View>

        <View style={styles.sectionBody}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalContent}
          >
            {HR_MENU_ITEMS.map((item) => (
              <HrButton
                key={item.nav}
                item={item}
                navigation={navigation}
                tileWidth={tileWidth}
                iconBoxSize={iconBoxSize}
                iconSize={iconSize}
                brandColor={brandColor}
              />
            ))}
          </ScrollView>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={[styles.sectionHeader, { backgroundColor: brandColor }]}>
          <View style={styles.sectionIconBubble}>
            <MaterialCommunityIcons
              name="card-account-details"
              size={SIZES.xxLarge}
              color={COLORS.white}
            />
          </View>
          <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
            Your Records In The Company
          </Text>
          <View style={styles.sectionIconBubble}>
            <AntDesign name="right" size={18} color={COLORS.white} />
          </View>
        </View>

        <View style={styles.sectionBody}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalContent}
          >
            {loadingShortcuts && shortcuts.length === 0
              ? [1, 2, 3].map((item) => (
                  <View
                    key={`shortcut-skeleton-${item}`}
                    style={[styles.tileButton, { width: tileWidth }]}
                  >
                    <View style={styles.tileInner}>
                      <View
                        style={[
                          styles.skeletonIcon,
                          {
                            width: iconBoxSize,
                            height: iconBoxSize,
                            borderRadius: 14,
                          },
                        ]}
                      />
                      <View style={styles.skeletonText} />
                    </View>
                  </View>
                ))
              : recordsToShow.map((shortcut, index) => (
                  <ShortcutButton
                    key={shortcut.shortcut || index}
                    shortcut={shortcut}
                    navigation={navigation}
                    tileWidth={tileWidth}
                    iconBoxSize={iconBoxSize}
                    iconSize={iconSize}
                    brandColor={brandColor}
                  />
                ))}

            <Pressable
              onPress={() => navigation.navigate("My QR Code")}
              style={({ pressed }) => [
                styles.tileButton,
                { width: tileWidth },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.tileInner}>
                <View
                  style={[
                    styles.tileIconWrap,
                    {
                      width: iconBoxSize,
                      height: iconBoxSize,
                      borderRadius: 14,
                    },
                  ]}
                >
                  <Ionicons name="qr-code" size={iconSize} color={brandColor} />
                </View>
                <Text style={styles.shortcutText}>My QR</Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <Pressable
        onPress={openWebsite}
        style={({ pressed }) => [
          styles.footerCard,
          { backgroundColor: brandColor },
          pressed && styles.footerPressed,
        ]}
      >
        <View style={styles.footerIconBubble}>
          <Ionicons name="globe-outline" size={SIZES.xxLarge - 2} color="#fff" />
        </View>

        <View style={styles.footerContent}>
          <Text style={styles.footerLabel}>Visit</Text>
          <View style={styles.footerSiteRow}>
            <Text style={styles.footerTitle}>ERPGulf.com</Text>
            <Ionicons name="open-outline" size={16} color="#fff" />
          </View>
        </View>

        <View style={styles.footerIconBubble}>
          <AntDesign name="right" size={16} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginVertical: 8,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2F2936",
    letterSpacing: 0.4,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  menuLabelTablet: {
    fontSize: 15,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E7E5EC",
    overflow: "hidden",
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  sectionTitle: {
    flex: 1,
    marginHorizontal: 10,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "600",
  },
  sectionTitleTablet: {
    fontSize: 20,
  },
  sectionBody: {
    paddingVertical: 12,
  },
  horizontalContent: {
    paddingHorizontal: 10,
    paddingBottom: 2,
  },
  tileButton: {
    marginRight: 14,
  },
  tileInner: {
    alignItems: "center",
  },
  tileIconWrap: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F2F6FC",
    borderWidth: 1,
    borderColor: "#E4EAF3",
  },
  tileTextWrap: {
    marginTop: 6,
    minHeight: 30,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  menuText: {
    fontSize: 11,
    lineHeight: 13,
    textAlign: "center",
    color: "#707187",
    fontWeight: "500",
  },
  menuTextBold: {
    color: "#4E4A58",
    fontWeight: "700",
  },
  menuTextSecondLine: {
    marginTop: 1,
  },
  shortcutText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 13,
    textAlign: "center",
    color: "#707187",
    fontWeight: "600",
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  skeletonIcon: {
    backgroundColor: "#E7E7EC",
  },
  skeletonText: {
    marginTop: 8,
    width: 52,
    height: 10,
    borderRadius: 6,
    backgroundColor: "#E7E7EC",
  },
  footerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 2,
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 7,
    },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 6,
  },
  footerPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  footerIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  footerContent: {
    flex: 1,
    marginHorizontal: 10,
  },
  footerLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "500",
  },
  footerSiteRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 1,
  },
  footerTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    marginRight: 6,
  },
});

export default LavaMenu;

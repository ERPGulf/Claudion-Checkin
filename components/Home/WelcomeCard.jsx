import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../../constants";

function WelcomeCard() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const fullname = useSelector((state) => state.user.fullname);
  const unreadCount = useSelector(
    (state) => state.notification?.unreadCount ?? 0,
  );

  const isSmall = width < 360;
  const isTablet = width >= 768;
  const isRtlName = Boolean(fullname && /[\u0600-\u06FF]/.test(fullname));
  const badgeLabel = unreadCount > 99 ? "99+" : unreadCount;
  const cardButtonSize = isTablet ? 52 : 46;
  const waveBadgeSize = isTablet ? 46 : 42;
  const titleSize = isTablet ? 28 : isSmall ? 22 : 24;
  const fullNameSize = isTablet ? 30 : isSmall ? 23 : SIZES.xxLarge;

  return (
    <View
      style={[
        styles.card,
        {
          minHeight: isTablet ? 222 : isSmall ? 184 : 196,
          paddingHorizontal: isTablet ? 20 : isSmall ? 12 : 14,
          paddingVertical: isTablet ? 16 : 12,
        },
      ]}
    >
      <View
        style={[
          styles.topGlow,
          isTablet && {
            width: 180,
            height: 180,
            borderRadius: 90,
            top: -60,
          },
        ]}
      />
      <View
        style={[
          styles.bottomGlow,
          isTablet && {
            width: 210,
            height: 210,
            borderRadius: 105,
            bottom: -90,
          },
        ]}
      />

      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.title, { fontSize: titleSize }]}>Home</Text>
          <Text style={[styles.subtitle, isTablet && styles.subtitleTablet]}>
            Dashboard
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate("Notifications")}
          style={[
            styles.notificationButton,
            {
              width: cardButtonSize,
              height: cardButtonSize,
              borderRadius: cardButtonSize / 2,
            },
          ]}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons
            name="bell"
            color={COLORS.white}
            size={isTablet ? 28 : 24}
          />
          {unreadCount > 0 && (
            <View style={[styles.badgeWrap, isTablet && styles.badgeWrapTablet]}>
              <Text style={[styles.badgeText, isTablet && styles.badgeTextTablet]}>
                {badgeLabel}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View>
        <Text style={[styles.welcomeLabel, isTablet && styles.welcomeLabelTablet]}>
          Welcome back,
        </Text>
        <View style={styles.nameRow}>
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.fullName,
              {
                fontSize: fullNameSize,
                lineHeight: isTablet ? 38 : isSmall ? 29 : 31,
              },
              isRtlName && styles.fullNameRtl,
            ]}
          >
            {fullname || "username"}
          </Text>
          <View
            style={[
              styles.waveBadge,
              {
                width: waveBadgeSize,
                height: waveBadgeSize,
                borderRadius: waveBadgeSize / 2,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="hand-wave"
              color="white"
              size={isTablet ? 26 : 24}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: 22,
    justifyContent: "space-between",
    backgroundColor: COLORS.brandPrimary,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  topGlow: {
    position: "absolute",
    top: -48,
    right: -12,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(0,0,35,0.26)",
  },
  bottomGlow: {
    position: "absolute",
    bottom: -75,
    left: -28,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTextWrap: {
    flexShrink: 1,
    marginRight: 12,
  },
  title: {
    color: COLORS.white,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: -2,
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  subtitleTablet: {
    fontSize: 13,
  },
  notificationButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  badgeWrap: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeWrapTablet: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "700",
  },
  badgeTextTablet: {
    fontSize: 11,
  },
  welcomeLabel: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  welcomeLabelTablet: {
    fontSize: 16,
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  fullName: {
    flex: 1,
    textAlign: "left",
    writingDirection: "auto",
    fontWeight: "700",
    color: COLORS.white,
    paddingRight: 10,
  },
  fullNameRtl: {
    textAlign: "right",
  },
  waveBadge: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
});

export default WelcomeCard;

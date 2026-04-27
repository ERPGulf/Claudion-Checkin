import { View, Text, StyleSheet } from "react-native";
import React from "react";
import { useSelector } from "react-redux";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SIZES } from "../../constants";

const BRAND_PRIMARY = "hsl(188, 84%, 14%)";

function WelcomeCard() {
  const fullname = useSelector((state) => state.user.fullname);

  // Detect Arabic characters only for name direction
  const isArabic = fullname && /[\u0600-\u06FF]/.test(fullname);

  return (
    <View style={styles.card}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={styles.headerRow}>
        <View style={styles.chip}>
          <MaterialCommunityIcons
            name="shield-check-outline"
            size={14}
            color={COLORS.white}
          />
          <Text style={styles.chipText}>Secure Login</Text>
        </View>
      </View>

      <View>
        <Text style={styles.greeting}>Welcome back</Text>

        <View style={styles.nameRow}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={2}
            style={[
              styles.fullname,
              { textAlign: isArabic ? "right" : "left" },
            ]}
          >
            {fullname || "username"}
          </Text>

          <View style={styles.waveWrap}>
            <MaterialCommunityIcons
              name="hand-wave"
              color={COLORS.white}
              size={22}
            />
          </View>
        </View>

        <Text style={styles.subtext}>
          Use your password to continue to Claudion.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BRAND_PRIMARY,
    width: "100%",
    minHeight: 220,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
    justifyContent: "space-between",
    overflow: "hidden",
    shadowColor: "rgba(0,0,0,0.45)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 6,
  },
  glowTop: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.14)",
    top: -70,
    right: -50,
  },
  glowBottom: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(255,255,255,0.09)",
    bottom: -90,
    left: -45,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  chipText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  greeting: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  fullname: {
    flex: 1,
    writingDirection: "auto",
    fontSize: SIZES.xxLarge,
    fontWeight: "700",
    color: COLORS.white,
    lineHeight: 34,
    marginRight: 10,
  },
  waveWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  subtext: {
    marginTop: 10,
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    lineHeight: 18,
  },
});

export default WelcomeCard;

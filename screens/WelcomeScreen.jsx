import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import React from "react";
import { useNavigation } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { COLORS } from "../constants";
import icon from "../assets/icon.png";

function WelcomeScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView
      style={styles.safeArea}
      className="px-5 relative"
      edges={["top", "bottom"]}
    >
      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <View className="w-full flex-1 justify-between pt-8 pb-6">
        <View />

        <View className="items-center">
          <View style={styles.logoContainer}>
            <Image
              cachePolicy="memory-disk"
              source={icon}
              style={styles.logo}
              contentFit="contain"
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.ctaButton}
          className="h-16 rounded-3xl justify-center items-center"
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Scan QR to get started"
          onPress={() => navigation.navigate("Qrscan")}
        >
          <View className="w-full h-full rounded-3xl justify-center items-center relative flex-row px-5">
            <Text style={styles.ctaText}>SCAN QR TO CONTINUE</Text>
            <View style={styles.ctaIconWrap}>
              <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FCFBF8",
  },
  bgCircleTop: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(248,118,39,0.12)",
    top: -60,
    right: -80,
  },
  bgCircleBottom: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(17,14,17,0.06)",
    bottom: -130,
    left: -100,
  },
  logoContainer: {
    width: 220,
    height: 220,
    borderRadius: 40,
    backgroundColor: COLORS.white,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 25,
    elevation: 7,
    marginBottom: 24,
  },
  logo: {
    width: 170,
    height: 170,
  },
  ctaButton: {
    width: "100%",
    backgroundColor: "hsl(188, 84%, 14%)",
    shadowColor: "hsl(188, 84%, 14%)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8,
  },
  ctaText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  ctaIconWrap: {
    position: "absolute",
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.22)",
    justifyContent: "center",
    alignItems: "center",
  },
});

export default WelcomeScreen;

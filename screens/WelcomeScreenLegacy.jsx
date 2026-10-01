import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { COLORS, BUILD_TAG, SPACING } from "../constants";
import ActionButton from "../components/common/ActionButton";
import { isMobileAuthAvailable } from "../utils/mobileAuthCrypto";
import icon from "../assets/icon.png";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Welcome / Get Started
 * screen, with the sign-in choices shared with the modern welcome.
 *
 * Retains the classic logo and QR destination while offering mobile sign-in
 * through the shared controls. The container still chooses the UI preference.
 *
 * Delete this file with the rest of the experiment.
 */
function WelcomeScreenLegacy() {
  const navigation = useNavigation();

  return (
    <SafeAreaView
      style={{
        flex: 1,
        alignItems: "center",
        backgroundColor: COLORS.white,
      }}
      className="px-3 relative items-center justify-center"
      edges={["top", "bottom"]}
    >
      <ScrollView
        style={{ width: "100%" }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: SPACING.xxl }}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: SPACING.xl }}>
          <Image
            cachePolicy="memory-disk"
            source={icon}
            style={{ width: 250, height: 250 }}
          />

          <Text style={{ color: COLORS.gray2, fontSize: 12, marginTop: 8 }}>
            {BUILD_TAG}
          </Text>
        </View>

        <View
          style={{
            width: "100%",
            paddingHorizontal: SPACING.lg,
          }}
        >
          <ActionButton
            label="Scan QR code"
            icon="qr-code-outline"
            size="lg"
            onPress={() => navigation.navigate("Qrscan")}
          />
          {isMobileAuthAvailable() && (
            <ActionButton
              label="Sign in with mobile number"
              icon="phone-portrait-outline"
              variant="outline"
              size="lg"
              style={{ marginTop: SPACING.md }}
              onPress={() => navigation.navigate("mobile login")}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default WelcomeScreenLegacy;

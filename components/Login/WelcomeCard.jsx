import { View, Text } from "react-native";
import React from "react";
import { useSelector } from "react-redux";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SIZES } from "../../constants";

function WelcomeCard() {
  const fullname = useSelector((state) => state.user.fullname);

  // Detect Arabic characters only for name direction
  const isArabic = fullname && /[\u0600-\u06FF]/.test(fullname);

  return (
    <View
      style={{
        backgroundColor: COLORS.primary,
        width: "100%",
        minHeight: 260, // increased for longer names
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 16,
        justifyContent: "space-between",
      }}
    >
      {/* Top title section */}
      <View className="flex-row justify-center items-center mb-20">
        <Text className="text-3xl font-bold text-white">Login</Text>
      </View>

      {/* Greeting section */}
      <View>
        <Text className="text-xl font-semibold text-white mb-1">Hey,</Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={2}
            style={{
              width: "90%",
              textAlign:
                fullname && /[\u0600-\u06FF]/.test(fullname) ? "right" : "left",
              writingDirection: "auto",
              flexShrink: 1,
              flexWrap: "wrap",
              fontSize: SIZES.xxLarge,
              fontWeight: "600",
              color: COLORS.white,
              fontFamily: undefined,
            }}
          >
            {fullname || "username"}
          </Text>

          <View className="bg-gray-800 w-10 h-10 items-center justify-center rounded-full ml-2">
            <MaterialCommunityIcons name="hand-wave" color="white" size={24} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default WelcomeCard;

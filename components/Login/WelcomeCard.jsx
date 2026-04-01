import { View, Text } from "react-native";
import React from "react";
import { useSelector } from "react-redux";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, SIZES } from "../../constants";
import icon from "../../assets/images/ERP-Gulf-Logo.png";
import { Image } from "expo-image";

function WelcomeCard() {
  const fullname = useSelector((state) => state.user.fullname);
  // Detect Arabic characters only for name direction
  const isArabic = fullname && /[\u0600-\u06FF]/.test(fullname);

  return (
    <LinearGradient
      colors={["#C63A2D", "#B33438", "#8C2A4F", "#6B1E6B"]}
      // locations REMOVED (safe)
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        width: "100%",
        height: 167,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: "#63205F",
        padding: 1,
        alignSelf: "center",
      }}
    >
      <LinearGradient
        colors={["#FFE8EA", "#FFE8EA"]}
        style={{
          flex: 1,
          borderRadius: 7,
          paddingTop: 16,
          paddingHorizontal: 16,
        }}
      >
        {/* Title */}
        <View style={{ marginBottom: 20 }}>
          <Text
            style={{
              fontSize: 20,
              fontFamily: "Inter-SemiBold",
              color: "#63205F",
              fontWeight: "600",
            }}
          >
            Login
          </Text>
        </View>
        {/* Logo */}
        <Image
          source={icon}
          style={{
            position: "absolute",
            top: 9,
            right: 7,
            width: 150,
            height: 68,
            resizeMode: "contain",
          }}
        />

        {/* Greeting */}
        <View
          style={{
            position: "absolute",
            left: 20,
            top: "75%",
            right: 20,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: 24,
              fontFamily: "Inter-Medium",
              color: "#000",
              lineHeight: 29,
              textAlign:
                fullname && /[\u0600-\u06FF]/.test(fullname) ? "right" : "left",
              writingDirection: "auto",
              flexShrink: 1,
              flexWrap: "wrap",
            }}
          >
            {(fullname || "username") + "!"}
          </Text>
        </View>
      </LinearGradient>
    </LinearGradient>
  );
}

export default WelcomeCard;

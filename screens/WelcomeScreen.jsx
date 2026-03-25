import { View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import React from "react";
import { useNavigation } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { COLORS } from "../constants";
import icon from "../assets/images/ERP-Gulf-Logo.png";
import { LinearGradient } from "expo-linear-gradient";
import SubmitButton from "../components/common/SubmitButton";

function WelcomeScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: COLORS.white,
      }}
      className="relative items-center justify-center"
      edges={["top", "bottom"]}
    >
      <View className="justify-center items-center">
        <Image
          cachePolicy="memory-disk"
          source={icon}
          style={{
            width: 294,
            height: 133,
            resizeMode: "contain",
          }}
        />
      </View>
      <SubmitButton
        title="Get Started!"
        height={56}
        onPress={() => navigation.navigate("Qrscan")}
        style={{
          position: "absolute",
          bottom: 24,
          width: "90%",
          alignSelf: "center",
        }}
        textStyle={{
          fontSize: 24, // ✅ override
          fontWeight: "500",
          color: "#FFF",
          // fontFamily: "Inter_500Medium" (if using font)
        }}
      />
    </SafeAreaView>
  );
}

export default WelcomeScreen;

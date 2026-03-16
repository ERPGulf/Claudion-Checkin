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
        onPress={() => navigation.navigate("Qrscan")}
        gradientColors={["#77224C", "#8E273B"]}
        paddingVertical={13}
        paddingHorizontal={108}
        borderRadius={7}
        textStyle={{ fontSize: 24, fontWeight: "500" }}
        style={{
          position: "absolute",
          bottom: 24,
          alignSelf: "center",
        }}
      />
    </SafeAreaView>
  );
}

export default WelcomeScreen;

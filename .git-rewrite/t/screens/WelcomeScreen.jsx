import { View, Text, TouchableOpacity } from "react-native";
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
      style={{
        flex: 1,
        alignItems: "center",
        backgroundColor: COLORS.white,
      }}
      className="px-3 relative items-center justify-center"
      edges={["top", "bottom"]}
    >
      <View className="justify-center items-center">
        <Image
          cachePolicy="memory-disk"
          source={icon}
          style={{ width: 250, height: 250 }}
        />
      </View>

      <TouchableOpacity
        style={{
          width: "100%",
          borderWidth: 2,
          borderColor: COLORS.primary,
        }}
        className="h-16 rounded-2xl justify-center items-center absolute bottom-6"
        onPress={() => navigation.navigate("Qrscan")}
      >
        <View
          style={{ width: "100%" }}
          className="h-full rounded-2xl justify-center items-center relative flex-row"
        >
          <Text
            className="text-xl font-semibold text-center"
            style={{ color: COLORS.primary }}
          >
            GET STARTED
          </Text>

          <View className="absolute right-5">
            <Ionicons
              name="arrow-forward-outline"
              size={38}
              color={COLORS.primary}
            />
          </View>
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

export default WelcomeScreen;

import { View, Text, TouchableOpacity } from "react-native";
import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../../constants";

function WelcomeCard() {
  const navigation = useNavigation();
  const fullname = useSelector((state) => state.user.fullname);
 const unreadCount = useSelector(
  (state) => state.notification?.unreadCount ?? 0
);

  return (
    <View
      style={{ backgroundColor: COLORS.primary, width: "100%" }}
      className="h-48 rounded-2xl p-3 justify-between"
    >
      <View className="flex-row justify-center items-center relative h-14">
        <TouchableOpacity
          onPress={() => navigation.navigate("Notifications")}
          className="bg-gray-800 w-12 h-12 items-center justify-center rounded-full absolute right-1 top-1"
        >
          <MaterialCommunityIcons
            name="bell"
            color={COLORS.white}
            size={SIZES.xxLarge}
          />
          {unreadCount > 0 && (
            <View
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: "red",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 4,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 10,
                  fontWeight: "bold",
                }}
              >
                {unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Home</Text>
      </View>
      <View>
        <Text className="text-base font-medium text-white">Welcome,</Text>
        <View className="flex-row items-center space-x-2 -mt-1">
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
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
          <View className="bg-gray-800 w-10 h-10 items-center justify-center rounded-full">
            <MaterialCommunityIcons name="hand-wave" color="white" size={24} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default WelcomeCard;

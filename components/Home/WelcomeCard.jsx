import { View, Text, TouchableOpacity, Image } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";

function WelcomeCard() {
  const navigation = useNavigation();
  const fullname = useSelector((state) => state.user.fullname);
  const unreadCount = useSelector(
    (state) => state.notification?.unreadCount ?? 0,
  );

  return (
    <View className="my-2" style={{ width: "100%" }}>
      <LinearGradient
        colors={["#FFE8EA", "#FFE8EA"]}
        style={{
          width: "100%",
          height: 142,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: "#63205F",

          paddingHorizontal: 12,
          paddingBottom: 12,
          paddingTop: 0,
          paddingLeft: 0,
          justifyContent: "space-between",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          elevation: 5,
        }}
      >
        {/* Top Row */}
        <View className="flex-row justify-between items-center">
          <Image
            source={require("../../assets/images/ERP-Gulf-Logo.png")}
            style={{ width: 150, height: 68, resizeMode: "contain" }}
          />

          <TouchableOpacity
            onPress={() => navigation.navigate("Notifications")}
            style={{
              position: "absolute",
              top: 10,
              right: 4,
              backgroundColor: "#fff",
              width: 50,
              height: 50,
              padding: 10,
              borderRadius: 34,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons name="bell" size={30} color="#C63A2D" />

            {unreadCount > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: "red",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "white", fontSize: 9 }}>
                  {unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Bottom Row */}
        <View className="flex-row items-center justify-between">
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 18,
              fontWeight: "600",
              textAlign: "center",
              color: "#000",
            }}
          >
            {fullname ? `مرحبا يا ${fullname}` : "مرحبا"}
          </Text>

          <Image
            source={require("../../assets/images/user.png")}
            style={{
              width: 45,
              height: 45,
              padding:12,
              borderRadius: 22,
              borderWidth: 2,
              borderColor: "#63205F",
              marginLeft: 8,
            }}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

export default WelcomeCard;

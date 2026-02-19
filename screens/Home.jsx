import { ScrollView, View, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";
import { LavaMenu, QuickAccess, WelcomeCard } from "../components/Home";
import { COLORS, SIZES } from "../constants";
import { MaterialCommunityIcons } from "@expo/vector-icons";

function Home() {
  const navigation = useNavigation();
  return (
    <View
      style={{
        flex: 1,
        flexGrow: 1,
        alignItems: "center",
        paddingTop: Constants.statusBarHeight,
        paddingBottom: 68,
      }}
      className="bg-gray-200"
    >
      <ScrollView
        style={{ width: "95%" }}
        contentContainerStyle={{ justifyContent: "center" }}
        showsVerticalScrollIndicator={false}
        StickyHeaderComponent={WelcomeCard}
        alwaysBounceVertical
      >
        <WelcomeCard />
        <QuickAccess navigation={navigation} />
        <LavaMenu navigation={navigation} />
      </ScrollView>
      {/* 🔥 Floating ChangAI Button */}
      <TouchableOpacity
  style={styles.chatButton}
  activeOpacity={0.85}
  onPress={() => navigation.navigate("ChangAi")}
>
  <MaterialCommunityIcons
    name="robot-outline"
    size={22}
    color="#FFFFFF"
  />
</TouchableOpacity>

    </View>
  );
}
const styles = StyleSheet.create({
  chatButton: {
    position: "absolute",
    bottom: 90,
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor:  "#1F2937",
    justifyContent: "center",
    alignItems: "center",

    // Subtle premium shadow
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,

    // Optional subtle border
    borderWidth: 1,
    borderColor: "#1E293B",
  },
});

export default Home;

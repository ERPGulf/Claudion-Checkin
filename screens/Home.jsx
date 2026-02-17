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
        onPress={() => navigation.navigate("ChangAi")}
      >
        <MaterialCommunityIcons name="chat-processing" size={26} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  chatButton: {
    position: "absolute",
    bottom: 90, // above bottom tab space
    right: 20,
    backgroundColor: "#6C4AB6",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 5,
  },
});
export default Home;

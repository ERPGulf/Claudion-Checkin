import { ScrollView, View, Text, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LavaMenu, QuickAccess, WelcomeCard } from "../components/Home";

function Home() {
  const navigation = useNavigation();

  return (
    <View
      style={{
        width: "100%",
        alignSelf: "center", // ✅ IMPORTANT
        flex: 1,
        backgroundColor: "#FFF",
        paddingTop: Constants.statusBarHeight,
      }}
    >
      {/* SCROLL CONTENT */}
      <ScrollView
        style={{ width: "95%", alignSelf: "center" }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <WelcomeCard />
        <View style={{ marginTop: 22 }}>
          <QuickAccess />
        </View>
        <LavaMenu />
      </ScrollView>
    </View>
  );
}

export default Home;

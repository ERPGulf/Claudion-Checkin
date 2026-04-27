import { ScrollView, View, useWindowDimensions } from "react-native";
import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";
import { LavaMenu, QuickAccess, WelcomeCard } from "../components/Home";

function Home() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const isTablet = width >= 768;

  return (
    <View
      style={{
        flex: 1,
        paddingTop: Constants.statusBarHeight,
        paddingBottom: 68,
        paddingHorizontal: isTablet ? 20 : 10,
      }}
      className="bg-gray-200"
    >
      <ScrollView
        style={{ width: "100%" }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 860,
          alignSelf: "center",
          paddingBottom: 8,
        }}
        showsVerticalScrollIndicator={false}
        StickyHeaderComponent={WelcomeCard}
        alwaysBounceVertical
      >
        <WelcomeCard />
        <QuickAccess navigation={navigation} />
        <LavaMenu navigation={navigation} />
      </ScrollView>
    </View>
  );
}

export default Home;

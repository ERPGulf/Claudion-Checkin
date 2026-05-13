import { ScrollView, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { useCallback } from "react";
import { LavaMenu, QuickAccess, WelcomeCard } from "../components/Home";
import { COLORS, SIZES } from "../constants";
import { fetchTopicsFromServer } from "../services/notifications/fcm.service";

function Home() {
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      console.log("[Home] Screen focused - checking for topic updates");
      console.log("[Home] Calling fetchTopicsFromServer");

      fetchTopicsFromServer()
        .then((topics) => {
          console.log("[Home] fetchTopicsFromServer returned:", topics);
          console.log(
            "[Home] Topics count:",
            Array.isArray(topics) ? topics.length : 0,
          );
        })
        .catch((error) => {
          console.log("[Home] fetchTopicsFromServer error:", error?.message);
        });
    }, []),
  );

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
    </View>
  );
}

export default Home;

import { ScrollView, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback } from "react";
import { LavaMenu, QuickAccess, WelcomeCard } from "../components/Home";
import { LAYOUT, SPACING } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import { fetchTopicsFromServer } from "../services/notifications/fcm.service";
import { describeHttpFailure } from "../utils/httpDiagnostics";

/** Docked tab bar + breathing room, on top of the bottom safe-area inset. */
const TAB_BAR_CLEARANCE = LAYOUT.tabBarContentHeight + SPACING.xxl;

function Home() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  useFocusEffect(
    useCallback(() => {
      console.log("[Home] Screen focused - checking for topic updates");
      console.log("[Home] Calling fetchTopicsFromServer");

      fetchTopicsFromServer()
        .then((topics) => {
          console.log(
            "[Home] Topics count:",
            Array.isArray(topics) ? topics.length : 0,
          );
        })
        .catch((error) => {
          console.log("[Home] fetchTopicsFromServer error:", describeHttpFailure(error));
        });
    }, []),
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surfaceSecondary,
        paddingTop: insets.top,
      }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE,
        }}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
      >
        <WelcomeCard />

        <View style={{ height: SPACING.xxl }} />
        <QuickAccess navigation={navigation} />

        <View style={{ height: SPACING.xxl }} />
        <LavaMenu navigation={navigation} />
      </ScrollView>
    </View>
  );
}

export default Home;

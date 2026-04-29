import React, { useLayoutEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Entypo } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, SIZES } from "../constants";
import WelcomeCard from "../components/AttendanceAction/WelcomeCard";
import BreakInProgressBanner from "../components/AttendanceAction/BreakInProgressBanner";
import DevBreakTools from "../components/AttendanceAction/DevBreakTools";
import AttendanceActionForm from "../components/AttendanceAction/AttendanceActionForm";
import useAttendanceActionController from "../hooks/useAttendanceActionController";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function AttendanceAction() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const {
    actionLoading,
    applyDevBreakPreset,
    breakButtonLabel,
    breakButtonToneClass,
    breakDisabled,
    checkin,
    dateTime,
    devBreakMockMode,
    distanceInfo,
    handleBreak,
    handleCheckInOutPress,
    handleInvalidateAccessToken,
    isLocationBlocked,
    liveBreakTime,
    locationStatusText,
    monthlyCapMessage,
    onBreak,
    onRefresh,
    refresh,
    restrictLocation,
    restrictionLoaded,
    toggleDevBreakMockMode,
  } = useAttendanceActionController({ navigation });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance Action",
      headerTitleAlign: "center",
      statusBarTranslucent: false,
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Temporary loading screen
  if (!restrictionLoaded) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: "white" }}
        edges={["bottom", "left", "right"]}
      >
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text className="mt-2 text-gray-600">Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "white" }}
      edges={["bottom", "left", "right"]}
    >
      {actionLoading && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 50,
              backgroundColor: "rgba(0,0,0,0.5)",
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            },
          ]}
          className="items-center justify-center"
        >
          <ActivityIndicator size="large" color="white" />
          <Text className="text-white mt-2 text-base">Processing...</Text>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          backgroundColor: "white",
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={onRefresh} />
        }
      >
        <View style={{ width: "100%" }} className="flex-1 px-3">
          {onBreak && <BreakInProgressBanner liveBreakTime={liveBreakTime} />}

          <WelcomeCard />

          {__DEV__ && (
            <DevBreakTools
              devBreakMockMode={devBreakMockMode}
              onToggleDevBreakMockMode={toggleDevBreakMockMode}
              onInvalidateAccessToken={handleInvalidateAccessToken}
              onApplyPreset={applyDevBreakPreset}
            />
          )}

          <AttendanceActionForm
            dateTime={dateTime}
            locationStatusText={locationStatusText}
            distanceInfo={distanceInfo}
            restrictLocation={restrictLocation}
            checkin={checkin}
            actionLoading={actionLoading}
            isLocationBlocked={isLocationBlocked}
            onCheckInOutPress={handleCheckInOutPress}
            onBreakPress={handleBreak}
            breakDisabled={breakDisabled}
            breakButtonLabel={breakButtonLabel}
            breakButtonToneClass={breakButtonToneClass}
            monthlyCapMessage={monthlyCapMessage}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
export default AttendanceAction;

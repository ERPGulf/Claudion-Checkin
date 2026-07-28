import React, { useLayoutEffect } from "react";
import { View, TouchableOpacity, Text, ActivityIndicator } from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { FlashList } from "@shopify/flash-list";
import { LogCard, RenderLoader } from "../components/AttendanceHistory";
import { COLORS, SIZES } from "../constants";
import useAttendanceHistory from "../hooks/useAttendanceHistory";

/**
 * Classic Attendance History — the original screen, kept for users on Classic UI.
 *
 * Presentation is unchanged from before the redesign: same black LogCards, same
 * FlashList, same header, same "No attendance records found" copy for both the
 * error and empty cases. The only edit is that the query now comes from
 * useAttendanceHistory() instead of being declared inline, so this screen and the
 * modern one can never disagree about how history is fetched or paginated.
 *
 * Do not restyle this file. It is the before-picture in an A/B comparison.
 */
function AttendanceHistoryLegacy() {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance History",
      headerTitleAlign: "center",
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

  const {
    isLoading,
    isError,
    records,
    hasNextPage,
    isFetchingNextPage,
    loadMore,
  } = useAttendanceHistory();

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !records.length) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-base text-gray-600">
          No attendance records found
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <FlashList
        data={records}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        contentContainerStyle={{
          paddingVertical: 15,
          paddingHorizontal: 15,
        }}
        renderItem={({ item }) => (
          <LogCard
            type={item.log_type} // IN / OUT
            time={item.time}
            employeeName={item.employee_name}
            deviceId={item.device_id}
          />
        )}
        ListFooterComponent={
          <RenderLoader
            isLoading={isFetchingNextPage}
            hasNextPage={hasNextPage}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.2}
        estimatedItemSize={60}
      />
    </View>
  );
}

export default AttendanceHistoryLegacy;

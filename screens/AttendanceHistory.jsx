import React, { useLayoutEffect } from "react";
import { View, TouchableOpacity, Text, ActivityIndicator } from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { LogCard, RenderLoader } from "../components/AttendanceHistory";
import { COLORS, SIZES } from "../constants";
import { getUserAttendance } from "../services/api";

function AttendanceHistory() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);

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
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["attendanceHistory", employeeCode],
    queryFn: async ({ pageParam = 0 }) => {
      const result = await getUserAttendance(employeeCode, pageParam, 20);
      if (result.error) throw new Error(result.error);
      return result;
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < 20 ? undefined : allPages.length * 20,
  });

  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !data?.pages?.flat().length) {
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
        data={data.pages.flatMap((page) => page)}
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

export default AttendanceHistory;

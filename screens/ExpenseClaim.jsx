import {
  View,
  TouchableOpacity,
  Text,
} from 'react-native';
import React, { useLayoutEffect } from 'react';
import Entypo from '@expo/vector-icons/Entypo';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';

import { getExpenseClaims } from '../api/expenseApi';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { ExpenseCard, ClaimForm } from '../components/ExpenseClaim';
import { COLORS, SIZES } from '../constants';


function ExpenseClaim() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: 'Expense Claims',
      headerTitleAlign: 'center',
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
  }, []);

  const { isLoading, isError, data, fetchNextPage, hasNextPage } =
    useInfiniteQuery({
      queryKey: ['expenseClaims', employeeCode],
      queryFn: ({ pageParam = 0 }) =>
        getExpenseClaims(employeeCode, pageParam),
      getNextPageParam: (lastPage, allPages) => {
        if (lastPage.length === 0) return undefined;
        return allPages.length;
      },
    });

  const loadMoreItem = () => {
    if (hasNextPage) {
      fetchNextPage();
    }
  };

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-base text-gray-600">No expense claims found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <FlashList
        data={data?.pages?.flatMap(page => page)}
        contentContainerStyle={{
          paddingVertical: 15,
          paddingHorizontal: 15,
          backgroundColor: COLORS.white,
        }}
        renderItem={({ item }) => (
          <ExpenseCard claim={item} />
        )}
        ListFooterComponent={
          <ClaimForm isLoading={isLoading} hasNextPage={hasNextPage} />
        }
        onEndReached={loadMoreItem}
        onEndReachedThreshold={0.1}
        estimatedItemSize={50}
      />
    </View>
  );
}

export default ExpenseClaim;

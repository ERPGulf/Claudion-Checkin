import {
  View,
  TouchableOpacity,
  Text,
} from "react-native";
import React, { useLayoutEffect, useState } from "react";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { FlashList } from "@shopify/flash-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { getExpenseTypes, createExpenseClaim } from "../api/userApi";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { ExpenseCard, ClaimForm } from "../components/ExpenseClaim";
import { COLORS, SIZES } from "../constants";

function ExpenseClaim() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);
  const queryClient = useQueryClient();

  // Local state to keep created claims
  const [claims, setClaims] = useState([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Expense Claims",
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

  // Fetch available expense types (dummy now, real later)
  const {
    isLoading,
    isError,
    data: expenseTypes,
  } = useQuery({
    queryKey: ["expenseTypes"],
    queryFn: getExpenseTypes,
  });

  // Mutation for creating claims
  const { mutate: addClaim, isPending: isCreating } = useMutation({
    mutationFn: (claimData) => createExpenseClaim(employeeCode, claimData),
    onSuccess: (newClaim) => {
      setClaims((prev) => [...prev, newClaim]);
      queryClient.invalidateQueries(["expenseTypes"]); // optional
    },
  });

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-base text-gray-600">Loading...</Text>
      </View>
    );
  }

  if (isError || !expenseTypes) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-base text-gray-600">
          Failed to load expense types
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <FlashList
        data={claims}
        contentContainerStyle={{
          paddingVertical: 15,
          paddingHorizontal: 15,
          backgroundColor: COLORS.white,
        }}
        renderItem={({ item }) => <ExpenseCard claim={item} />}
        ListFooterComponent={
          <ClaimForm
            expenseTypes={expenseTypes}
            onSubmit={(formData) => addClaim(formData)}
            isLoading={isCreating}
          />
        }
        estimatedItemSize={50}
      />
    </View>
  );
}

export default ExpenseClaim;

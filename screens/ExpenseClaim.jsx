import React, { useLayoutEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { useQuery, useMutation } from "@tanstack/react-query";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import ClaimForm from "../components/ExpenseClaim/ClaimForm";
import ExpenseCard from "../components/ExpenseClaim/ExpenseCard";
// import { getExpenseClaims } from "../api/userApi";
import { COLORS, SIZES } from "../constants";
import { createExpenseClaim, getExpenseClaims } from "../services/api";

const PAGE_SIZE = 5;

export default function ExpenseClaim() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ✅ Header setup
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
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

  // ✅ Fetch expense claims
  const {
    data: claims = [],
    isLoading: isFetching,
    refetch,
  } = useQuery({
    queryKey: ["expenseClaims", employeeCode],
    queryFn: async () => {
      const data = await getExpenseClaims(employeeCode);
      return (data || []).sort(
        (a, b) => new Date(b.expense_date) - new Date(a.expense_date)
      );
    },
    enabled: !!employeeCode,
  });



  // ✅ React Query mutation
  const { mutate: addClaim, isPending: isCreating } = useMutation({
    mutationFn: createExpenseClaim,
    onSuccess: async () => {
      await refetch();
      Alert.alert("Success", "Expense claim created successfully!");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create expense claim.");
    },
  });

  // ✅ Loading state
  if (isFetching) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text className="mt-3 text-gray-600">Loading expense claims...</Text>
      </View>
    );
  }

  // ✅ Pagination
  const visibleClaims = claims.slice(0, visibleCount);
  const hasMore = visibleCount < claims.length;

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{ padding: 16 }}
    >
      {/* Claim Form */}
      <ClaimForm onSubmit={addClaim} isLoading={isCreating} />

      <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">
        Expense Claim History
      </Text>

      {visibleClaims.length === 0 ? (
        <Text className="text-gray-500 text-center mt-6">
          No expense claims yet.
        </Text>
      ) : (
        visibleClaims.map((item) => (
          <View key={item.name || item.id} className="mb-4">
            <ExpenseCard claim={item} />
          </View>
        ))
      )}

      {hasMore && (
        <TouchableOpacity
          onPress={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
          className="p-3 mb-6 rounded bg-gray-300"
        >
          <Text className="text-center font-semibold">Load More</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

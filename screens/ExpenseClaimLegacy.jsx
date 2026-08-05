import React, { useLayoutEffect } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import ClaimForm from "../components/ExpenseClaim/ClaimForm";
import ExpenseCard from "../components/ExpenseClaim/ExpenseCard";
import { COLORS, SIZES } from "../constants";
import useExpenseClaims from "../hooks/useExpenseClaims";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Expense Claims
 * screen, preserved exactly as it shipped.
 *
 * The markup below is the original `screens/ExpenseClaim.jsx` unchanged: same
 * header, same gray-100 loading state, same white ScrollView, same
 * "Expense Claim History" heading, same gray "Load More" button. Only the source
 * of its data moved — the query, the mutation and the pagination cursor now come
 * from hooks/useExpenseClaims.js, shared with the modern screen, so the two can
 * never disagree about what a claim is or how one is created.
 *
 * On removal of the experiment: delete this file and point the "Expense claim"
 * route at `screens/ExpenseClaim.jsx` unconditionally.
 */
export default function ExpenseClaimLegacy() {
  const navigation = useNavigation();

  const {
    visibleClaims,
    isFetching,
    hasMore,
    loadMore,
    addClaim,
    isCreating,
    resetFormFlag,
  } = useExpenseClaims();

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

  // ✅ Loading state
  if (isFetching) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: "#f3f4f6" }}
        edges={["bottom"]}
      >
        <View className="flex-1 justify-center items-center bg-gray-100">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text className="mt-3 text-gray-600">Loading expense claims...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.white }}
      edges={["bottom"]}
    >
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* Claim Form */}
        <ClaimForm
          onSubmit={addClaim}
          isLoading={isCreating}
          resetSignal={resetFormFlag}
        />

        <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">
          Expense Claim History
        </Text>

        {visibleClaims.length === 0 ? (
          <Text className="text-gray-500 text-center mt-6">
            No expense claims yet.
          </Text>
        ) : (
          visibleClaims.map((item, index) => (
            <View key={item?.name || index} className="mb-4">
              <ExpenseCard claim={item} />
            </View>
          ))
        )}

        {hasMore && (
          <TouchableOpacity
            onPress={loadMore}
            className="p-3 mb-6 rounded bg-gray-300"
          >
            <Text className="text-center font-semibold">Load More</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

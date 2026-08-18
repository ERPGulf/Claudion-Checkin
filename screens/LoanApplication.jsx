import React, { useLayoutEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import Entypo from "@expo/vector-icons/Entypo";

import LoanApplicationForm from "../components/LoanApplication/LoanApplicationForm";
import LoanApplicationCard from "../components/LoanApplication/LoanApplicationCard";

import {
  LoanApplicationRequest,
  getLoanApplications,
} from "../services/api/loanApplication.service";

import { COLORS, SIZES } from "../constants";
import { useSelector } from "react-redux";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";

const PAGE_SIZE = 5;

export default function LoanApplication() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [resetFormFlag, setResetFormFlag] = useState(false);

  /* ===========================
     Header
  =========================== */

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Loan Application",
      headerTitleAlign: "center",

      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ paddingLeft: 8 }}
        >
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  /* ===========================
     Fetch Loan Applications
  =========================== */

  const {
    data: loanApplications = [],
    isLoading: isFetching,
    refetch,
  } = useQuery({
    queryKey: ["loanApplications", employeeCode],

    queryFn: async () => {
      const res = await getLoanApplications();

      if (res?.error) {
        throw new Error(res.error);
      }

      return (res?.message || []).sort(
        (a, b) => new Date(b.posting_date) - new Date(a.posting_date),
      );
    },

    enabled: !!employeeCode,
  });

  /* ===========================
     Submit Loan Application
  =========================== */

  const { mutateAsync: submitRequest, isPending: isCreating } = useMutation({
    mutationFn: LoanApplicationRequest,

    onSuccess: async (response) => {
      console.log(
        "Loan application success:",
        JSON.stringify(response, null, 2),
      );

      // Refresh loan application history
      await refetch();

      Alert.alert("Success", "Loan application submitted successfully.", [
        {
          text: "OK",
          onPress: () => {
            setResetFormFlag((prev) => !prev);
          },
        },
      ]);
    },

    onError: (err) => {
      console.log("Loan application mutation error:", err);

      Alert.alert("Error", err.message || "Failed to submit loan application.");
    },
  });

  /* ===========================
     Pagination
  =========================== */

  const visibleLoans = loanApplications.slice(0, visibleCount);

  const hasMore = visibleCount < loanApplications.length;

  /* ===========================
     UI
  =========================== */

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: COLORS.white,
      }}
      edges={["bottom"]}
    >
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 30,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Loan Application Form */}

        <LoanApplicationForm
          onSubmit={submitRequest}
          isLoading={isCreating}
          resetSignal={resetFormFlag}
        />

        {/* Loan Application History */}

        <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">
          Loan Application History
        </Text>

        {isFetching ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={COLORS.primary} />

            <Text className="text-gray-500 mt-2">
              Loading loan applications...
            </Text>
          </View>
        ) : visibleLoans.length === 0 ? (
          <Text className="text-gray-500 text-center mt-6">
            No loan applications yet.
          </Text>
        ) : (
          visibleLoans.map((item, index) => (
            <View key={item?.name || index} className="mb-4">
              <LoanApplicationCard loan={item} />
            </View>
          ))
        )}

        {/* Load More */}

        {hasMore && (
          <TouchableOpacity
            onPress={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            className="p-3 mb-6 rounded bg-gray-300"
          >
            <Text className="text-center font-semibold">Load More</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

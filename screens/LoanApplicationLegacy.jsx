import React, { useLayoutEffect, useState } from "react";
import {
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import Entypo from "@expo/vector-icons/Entypo";

import LoanApplicationForm from "../components/LoanApplication/LoanApplicationForm";
import LoanApplicationCard from "../components/LoanApplication/LoanApplicationCard";
import {
  LoanApplicationRequest,
  getLoanApplications,
} from "../services/api/loanApplication.service";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";

/** Applications revealed per "Load More" press. Matches the modern screen. */
const PAGE_SIZE = 5;

/**
 * TEMPORARY (New Home Experience experiment) — the classic Loan Application
 * screen.
 *
 * Presentation is the classic one throughout: the same chevron header, the same
 * react-query mutation with the same Alerts, the same `resetFormFlag` signal and
 * the same <LoanApplicationForm>, which still owns the classic form's own state,
 * validation and payload. That form is not driven by hooks/useLoanApplication.js
 * — it keeps its own inline copy of the rules, so the two must be changed
 * together. Both now require the repayment amount and method.
 *
 * The submitted-application history below the form is the production feature,
 * rendered with the classic <LoanApplicationCard> and the classic grey "Load
 * More" button rather than the modern list, so this screen stays visually
 * unchanged apart from the section it gained.
 *
 * On removal of the experiment: delete this file and point the "Loan application"
 * route at `screens/LoanApplication.jsx` unconditionally.
 */
export default function LoanApplicationLegacy() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);

  const [resetFormFlag, setResetFormFlag] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Loan Application",
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

  /* ===========================
     Loan Application History
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
     Submit
  =========================== */

  const { mutateAsync: submitRequest, isPending } = useMutation({
    mutationFn: LoanApplicationRequest,

    onSuccess: async () => {
      // Refresh before the Alert, so the new application is already in the list
      // behind it rather than appearing a beat after "OK".
      await refetch();
      setVisibleCount(PAGE_SIZE);

      Alert.alert("Success", "Loan application submitted successfully.", [
        {
          text: "OK",
          onPress: () => setResetFormFlag((prev) => !prev),
        },
      ]);
    },

    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to submit loan application.");
    },
  });

  const visibleLoans = loanApplications.slice(0, visibleCount);
  const hasMore = visibleCount < loanApplications.length;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.white }}
      edges={["bottom"]}
    >
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      >
        <LoanApplicationForm
          onSubmit={submitRequest}
          isLoading={isPending}
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
          <>
            {visibleLoans.map((item, index) => (
              <View key={item?.name || index} className="mb-4">
                <LoanApplicationCard loan={item} />
              </View>
            ))}

            {hasMore && (
              <TouchableOpacity
                onPress={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="p-3 mb-6 rounded bg-gray-300"
              >
                <Text className="text-center font-semibold">Load More</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

import React, { useLayoutEffect, useState } from "react";
import { TouchableOpacity, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import Entypo from "@expo/vector-icons/Entypo";

import LoanApplicationForm from "../components/LoanApplication/LoanApplicationForm";
import { LoanApplicationRequest } from "../services/api/loanApplication.service";
import { COLORS, SIZES } from "../constants";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Loan Application
 * screen, preserved exactly as it shipped.
 *
 * Everything below is the original `screens/LoanApplication.jsx` verbatim: the
 * same header, the same react-query mutation with the same Alerts, the same
 * `resetFormFlag` signal and the same <LoanApplicationForm> — which is itself
 * untouched and still owns the classic form's state, validation and payload.
 * hooks/useLoanApplication.js is a faithful lift of that flow, used by the modern
 * screen only, so this file is unaffected by the redesign.
 *
 * On removal of the experiment: delete this file and point the "Loan application"
 * route at `screens/LoanApplication.jsx` unconditionally.
 */
export default function LoanApplicationLegacy() {
  const navigation = useNavigation();
  const [resetFormFlag, setResetFormFlag] = useState(false);

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

  const { mutateAsync: submitRequest, isPending } = useMutation({
    mutationFn: LoanApplicationRequest,

    onSuccess: () => {
      Alert.alert("Success", "Loan application submitted successfully.", [
        {
          text: "OK",
          onPress: () => setResetFormFlag((prev) => !prev),
        },
      ]);
    },

    onError: (err) => {
      Alert.alert(
        "Error",
        err.message || "Failed to submit loan application."
      );
    },
  });

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.white }}
      edges={["bottom"]}
    >
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={{ padding: 16 }}
      >
        <LoanApplicationForm
          onSubmit={submitRequest}
          isLoading={isPending}
          resetSignal={resetFormFlag}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
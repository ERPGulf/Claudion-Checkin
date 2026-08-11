import React, { useLayoutEffect, useState } from "react";
import { TouchableOpacity, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import Entypo from "@expo/vector-icons/Entypo";

import LoanApplicationForm from "../components/LoanApplication/LoanApplicationForm";
import { LoanApplicationRequest } from "../services/api/loanApplication.service";
import { COLORS, SIZES } from "../constants";

export default function LoanApplication() {
  const navigation = useNavigation();

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
     Submit Loan Application
  =========================== */

  const { mutateAsync: submitRequest, isPending } = useMutation({
    mutationFn: LoanApplicationRequest,

    onSuccess: (response) => {
      console.log(
        "Loan application success:",
        JSON.stringify(response, null, 2),
      );

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
        <LoanApplicationForm
          onSubmit={submitRequest}
          isLoading={isPending}
          resetSignal={resetFormFlag}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

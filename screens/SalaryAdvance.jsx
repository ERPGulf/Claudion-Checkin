import React, { useLayoutEffect, useState } from "react";
import { View, TouchableOpacity, Alert, ScrollView } from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import SalaryAdvanceForm from "../components/SalaryAdvance/SalaryAdvanceForm";
import { COLORS, SIZES } from "../constants";
import { SalaryAdvanceRequest } from "../services/api/salaryAdvance.service";

export default function SalaryAdvance() {
  const navigation = useNavigation();
  const [resetFormFlag, setResetFormFlag] = useState(false);

  // Header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Salary Advance",
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
    mutationFn: SalaryAdvanceRequest,

    onSuccess: () => {
      Alert.alert("Success", "Salary advance request submitted successfully.", [
        {
          text: "OK",
          onPress: () => setResetFormFlag((prev) => !prev),
        },
      ]);
    },

    onError: (err) => {
      Alert.alert(
        "Error",
        err.message || "Failed to submit salary advance request.",
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
        <SalaryAdvanceForm
          onSubmit={submitRequest}
          isLoading={isPending}
          resetSignal={resetFormFlag}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

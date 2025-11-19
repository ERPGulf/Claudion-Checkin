import React, { useLayoutEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { useQuery, useMutation } from "@tanstack/react-query";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import ClaimForm from "../components/ExpenseClaim/ClaimForm";
import ExpenseCard from "../components/ExpenseClaim/ExpenseCard";
// import { getExpenseClaims } from "../api/userApi";
import { COLORS, SIZES } from "../constants";
import { getExpenseClaims } from "../services/api";

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

  // ✅ Correct single API call
  const createExpenseClaim = async (claimData) => {
    try {
      const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
      const baseUrl = rawBaseUrl?.trim()?.replace(/\/+$/, "");
      const token = await AsyncStorage.getItem("access_token");
      const employee = await AsyncStorage.getItem("employee_code");

      if (!baseUrl || !token || !employee)
        throw new Error("Missing base URL, token, or employee code");

      const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;

      // ✅ Build FormData correctly for backend 
      const formData = new FormData();
      formData.append("employee", employee);
      formData.append("expense_date", claimData.expense_date);
      formData.append("expense_type", claimData.expense_type);
      formData.append("amount", claimData.amount);
      formData.append("description", claimData.description || "");

      // ✅ Correct field name for file upload
      if (claimData.file_url && claimData.file_url.uri) {
        const file = claimData.file_url;
        const fileName = file.name || "receipt.jpg";
        const fileType =
          file.mimeType || file.type || `image/${fileName.split(".").pop()}`;

        formData.append("file", {
          uri: file.uri,
          name: fileName,
          type: fileType,
        });
      }

      console.log("📤 Sending expense claim to:", url);
      console.log("📦 Form data:", formData);

      const response = await axios.post(url, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      console.log("✅ Expense claim created:", response.data);
      return response.data;
    } catch (error) {
      console.error(
        "❌ Error creating expense claim:",
        error.response?.data || error.message
      );
      throw error;
    }
  };

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
      className="flex-1 bg-gray-100"
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

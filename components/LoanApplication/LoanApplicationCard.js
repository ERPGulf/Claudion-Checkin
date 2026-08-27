import React from "react";
import { View, Text } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import PropTypes from "prop-types";
import { COLORS } from "../../constants";

/**
 * One submitted loan application, in the classic card style.
 *
 * Legacy-only. The hardcoded greys are deliberate and correct *here*: the
 * classic screens are a light-only surface with no `useAppTheme()` anywhere in
 * them. The modern screen renders <LoanHistoryCard> instead, which takes every
 * colour off the palette so it works in dark mode.
 */

export default function LoanApplicationCard({ loan }) {
  const formatDate = (date) => {
    if (!date) return "-";

    const parsedDate = new Date(date);

    if (isNaN(parsedDate.getTime())) {
      return date;
    }

    return parsedDate.toLocaleDateString("en-GB");
  };

  const formatAmount = (amount) => {
    if (amount === null || amount === undefined) {
      return "-";
    }

    return Number(amount).toLocaleString();
  };

  return (
    <View
      className="bg-white rounded-xl p-4"
      style={{
        borderWidth: 1,
        borderColor: "#E5E7EB",
        shadowColor: "#000",
        shadowOffset: {
          width: 0,
          height: 1,
        },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 2,
      }}
    >
      {/* Header */}

      <View className="flex-row justify-between items-center mb-3">
        <View className="flex-row items-center flex-1">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{
              backgroundColor: "#F3F0FF",
            }}
          >
            <Ionicons
              name="cash-outline"
              size={22}
              color={COLORS.primary}
            />
          </View>

          <View className="flex-1">
            <Text
              className="text-base font-semibold text-gray-800"
              numberOfLines={1}
            >
              {loan?.name || "Loan Application"}
            </Text>

            <Text className="text-xs text-gray-500 mt-1">
              {formatDate(loan?.posting_date)}
            </Text>
          </View>
        </View>

        {/* Status */}

        <View
          className="px-3 py-1 rounded-full"
          style={{
            backgroundColor:
              loan?.status === "Open"
                ? "#DCFCE7"
                : "#F3F4F6",
          }}
        >
          <Text
            className="text-xs font-medium"
            style={{
              color:
                loan?.status === "Open"
                  ? "#166534"
                  : "#4B5563",
            }}
          >
            {loan?.status || "-"}
          </Text>
        </View>
      </View>

      {/* Amount */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          Loan Amount
        </Text>

        <Text className="text-sm font-semibold text-gray-800">
          {formatAmount(loan?.loan_amount)}
        </Text>
      </View>

      {/* Loan Product */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          Loan Product
        </Text>

        <Text className="text-sm font-medium text-gray-800">
          {loan?.loan_product || "-"}
        </Text>
      </View>

      {/* Repayment Method */}

      <View className="py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          Repayment Method
        </Text>

        <Text
          className="text-sm font-medium text-gray-800 mt-1"
          numberOfLines={2}
        >
          {loan?.repayment_method || "-"}
        </Text>
      </View>

      {/* Repayment Amount */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          Repayment Amount
        </Text>

        <Text className="text-sm font-semibold text-gray-800">
          {formatAmount(loan?.repayment_amount)}
        </Text>
      </View>

      {/* Reason */}

      <View className="pt-2">
        <Text className="text-sm text-gray-500">
          Reason
        </Text>

        <Text
          className="text-sm text-gray-700 mt-1"
          numberOfLines={3}
        >
          {loan?.reason || "-"}
        </Text>
      </View>
    </View>
  );
}

LoanApplicationCard.propTypes = {
  loan: PropTypes.object,
};

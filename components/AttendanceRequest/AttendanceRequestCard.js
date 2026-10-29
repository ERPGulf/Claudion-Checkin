import { translateMessage, t, useTranslation } from '../../localization';
import { formatExpenseDate, formatExpenseAmount } from '../../utils/expenseClaims';
import React from "react";
import { View } from 'react-native';
import Text from '../../localization/LocalizedText';
import Ionicons from "@expo/vector-icons/Ionicons";
import { COLORS } from "../../constants";
import PropTypes from "prop-types";

/**
 * Legacy-only. The hardcoded greys are deliberate here: the classic screens are
 * a light-only surface with no `useAppTheme()` in them. The modern screens
 * render <RecordCard>, which takes every colour off the palette so it works in
 * dark mode.
 */
export default function AttendanceRequestCard({
  request,
}) {
  useTranslation();
  const formatDate = formatExpenseDate;

  const formatTime = (time) => {
    if (!time) return "-";

    return time.substring(0, 5);
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case "Approved":
        return {
          backgroundColor: "#DCFCE7",
          color: "#166534",
        };

      case "Rejected":
        return {
          backgroundColor: "#FEE2E2",
          color: "#991B1B",
        };

      case "Open":
      case "Pending":
        return {
          backgroundColor: "#FEF3C7",
          color: "#92400E",
        };

      default:
        return {
          backgroundColor: "#F3F4F6",
          color: "#4B5563",
        };
    }
  };

  const statusStyle = getStatusStyle(
    request?.status,
  );

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
            className="w-10 h-10 rounded-full items-center justify-center"
            style={[{
              backgroundColor: "#F3F0FF",
            }, { marginEnd: 12 }]}
          >
            <Ionicons
              name="time-outline"
              size={22}
              color={COLORS.primary}
            />
          </View>

          <View className="flex-1">
            <Text
              className="text-base font-semibold text-gray-800"
              numberOfLines={1}
            >
              {request?.name || t("Attendance Request")}
            </Text>

            <Text className="text-xs text-gray-500 mt-1">
              {formatDate(request?.from_date)}
            </Text>
          </View>
        </View>

        {/* Status */}

        <View
          className="px-3 py-1 rounded-full"
          style={{
            backgroundColor:
              statusStyle.backgroundColor,
          }}
        >
          <Text
            className="text-xs font-medium"
            style={{
              color: statusStyle.color,
            }}
          >
            {request?.status ? translateMessage(request.status) : "-"}
          </Text>
        </View>
      </View>

      {/* From Date */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">{t("From Date")}</Text>

        <Text className="text-sm font-medium text-gray-800">
          {formatDate(request?.from_date)}
        </Text>
      </View>

      {/* To Date */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">{t("To Date")}</Text>

        <Text className="text-sm font-medium text-gray-800">
          {formatDate(request?.to_date)}
        </Text>
      </View>

      {/* From Time */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">{t("From Time")}</Text>

        <Text className="text-sm font-medium text-gray-800">
          {formatTime(request?.from_time)}
        </Text>
      </View>

      {/* To Time */}

      <View className="flex-row justify-between py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">{t("To Time")}</Text>

        <Text className="text-sm font-medium text-gray-800">
          {formatTime(request?.to_time)}
        </Text>
      </View>

      {/* Half Day */}

      {Number(request?.half_day) === 1 && (
        <View className="flex-row justify-between py-2 border-b border-gray-100">
          <Text className="text-sm text-gray-500">{t("Half Day")}</Text>

          <Text className="text-sm font-medium text-gray-800">{t("Yes")}</Text>
        </View>
      )}

      {/* Reason */}

      <View className="py-2 border-b border-gray-100">
        <Text className="text-sm text-gray-500">{t("Reason")}</Text>

        <Text
          className="text-sm text-gray-700 mt-1"
          numberOfLines={3}
        >
          {request?.reason ? translateMessage(request.reason) : "-"}
        </Text>
      </View>

      {/* Explanation */}

      {request?.explanation && (
        <View className="pt-2">
          <Text className="text-sm text-gray-500">{t("Explanation")}</Text>

          <Text
            className="text-sm text-gray-700 mt-1"
            numberOfLines={3}
          >
            {request.explanation}
          </Text>
        </View>
      )}
    </View>
  );
}

AttendanceRequestCard.propTypes = {
  request: PropTypes.object,
};

import { translateMessage, formatDate, t, useTranslation } from '../../localization';
import React from "react";
import { View } from 'react-native';
import Text from '../../localization/LocalizedText';
import PropTypes from "prop-types";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { describeLogType } from "../../utils/attendanceHistory";
import { COLORS } from "../../constants";

function LogCard({ type, time }) {
  const { language, direction, isRTL } = useTranslation();
  
  // Fix backend time format: remove microseconds + replace space with T
  let fixedTime = time?.split(".")[0];

  if (fixedTime?.includes(" ")) {
    fixedTime = fixedTime.replace(" ", "T");
  }

  const formattedDate = fixedTime
    ? formatDate(new Date(fixedTime), { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true })
    : t("Invalid date");

  const bgColor =
    type?.toUpperCase() === "IN"
      ? "bg-green-500"
      : type?.toUpperCase() === "OUT"
        ? "bg-red-500"
        : type?.toUpperCase() === "LATE ENTRY"
          ? "bg-yellow-500"
          : type?.toUpperCase() === "EARLY EXIT"
            ? "bg-orange-500"
            : "bg-gray-500";

  return (
    <View
      style={{ backgroundColor: COLORS.primary }}
      className="w-full flex-row h-16 rounded-xl py-2 px-4 justify-between items-center my-1"
    >
      <Text className="text-white font-semibold text-xs">
        {t("{{status}} at {{time}}", { status: describeLogType(type).label, time: formattedDate })}
      </Text>
      <View
        className={`justify-center items-center rounded-full p-1 ${bgColor}`}
      >
        <MaterialCommunityIcons name="clock-check" color="white" size={30} />
      </View>
    </View>
  );
}

LogCard.propTypes = {
  type: PropTypes.string,
  time: PropTypes.string,
};

LogCard.defaultProps = {
  type: "OUT",
  time: new Date().toISOString(),
};

export default LogCard;

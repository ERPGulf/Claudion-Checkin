import React from "react";
import { View, Text } from "react-native";
import PropTypes from "prop-types";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { format, parse } from "date-fns";
import { COLORS } from "../../constants";

function LogCard({ type, time }) {
  const formattedDate = time
    ? format(parse(time, "yyyy-MM-dd HH:mm:ss", new Date()), "hh:mm a, dd/MM/yy")
    : "Invalid date";

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
        CHECKED {type?.toUpperCase()} AT {formattedDate}
      </Text>
      <View className={`justify-center items-center rounded-full p-1 ${bgColor}`}>
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

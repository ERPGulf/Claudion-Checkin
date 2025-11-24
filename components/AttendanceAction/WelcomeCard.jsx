import { View, Text } from "react-native";
import { Image } from "expo-image";
import React, { useEffect, useState, useRef } from "react";
import { useSelector } from "react-redux";
import { differenceInSeconds } from "date-fns";
import { COLORS } from "../../constants";
import checkinimg from "../../assets/images/checkin.png";
import checkoutimg from "../../assets/images/checkout.png";
import {
  selectCheckin,
  selectCheckinTime,
  selectLocation,
  selectTodayHours,
  selectMonthlyHours,
} from "../../redux/Slices/AttendanceSlice";
function WelcomeCard() {
  const location = useSelector(selectLocation);
  const checkin = useSelector(selectCheckin);
  const checkinTime = useSelector(selectCheckinTime);
  // :white_check_mark: Redux totals from API
  const todayTotal = useSelector(selectTodayHours); // expects "HH:MM"
  const monthlyTotal = useSelector(selectMonthlyHours); // expects "HH:MM"
  // :white_check_mark: Live session timer
  const [sessionMinutes, setSessionMinutes] = useState(0);
  const intervalRef = useRef(null);
  const formatMinutes = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}`;
  };
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!checkin || !checkinTime) {
      setSessionMinutes(0);
      return;
    }
    const parsed = new Date(checkinTime);
    const update = () => {
      const seconds = differenceInSeconds(new Date(), parsed);
      const minutes = Math.floor(seconds / 60);
      setSessionMinutes(minutes);
    };
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkin, checkinTime]);
  return (
    <View
      style={{ width: "100%" }}
      className="px-4 py-4 bg-slate-200 rounded-xl justify-center items-center"
    >
      <View
        style={{ backgroundColor: COLORS.primary, width: "100%" }}
        className="h-60 rounded-lg px-3 w-full justify-center items-center"
      >
        <View className="flex-row justify-between w-full h-40 items-center">
          {checkin ? (
            <View className="w-3/5 break-words h-40 justify-center">
              <Text className="text-base font-normal pt-1 text-white">
                Working from
              </Text>
              <Text className="text-lg font-bold text-white pb-1">
                {location}
              </Text>
              <Text className="text-base font-normal pt-1 text-white">
                You have been working for
              </Text>
              <Text className="text-lg font-bold text-white">
                {formatMinutes(sessionMinutes)} Hours
              </Text>
              <Text className="text-sm font-normal pt-1 text-white">
                Today total: {todayTotal || "--:--"} Hours
              </Text>
              <Text className="text-sm font-normal pt-1 text-white">
                Monthly total: {monthlyTotal || "--:--"} Hours
              </Text>
            </View>
          ) : (
            <View className="w-6/12 h-40 justify-center">
              <Text className="text-base font-normal pt-2 text-white">
                Welcome Back!
              </Text>
              <Text className="text-lg pt-2 font-bold text-white">
                Check-In before you start working
              </Text>
            </View>
          )}
          <Image
            cachePolicy="memory-disk"
            source={checkin ? checkoutimg : checkinimg}
            className="h-24 w-24"
            contentFit="contain"
          />
        </View>
      </View>
    </View>
  );
}
export default WelcomeCard;

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
  selectBreakMinutes,
} from "../../redux/Slices/AttendanceSlice";

function WelcomeCard() {
  const location = useSelector(selectLocation);
  const checkin = useSelector(selectCheckin);
  const checkinTime = useSelector(selectCheckinTime);

  const todayTotal = useSelector(selectTodayHours);
  const monthlyTotal = useSelector(selectMonthlyHours);
  const breakMinutes = useSelector(selectBreakMinutes);
  const onBreak = useSelector((state) => state.attendance.onBreak);
  const breakStartTime = useSelector(
    (state) => state.attendance.breakStartTime,
  );
  const [liveBreakMinutes, setLiveBreakMinutes] = useState(0);
  const breakIntervalRef = useRef(null);
  const [sessionMinutes, setSessionMinutes] = useState(0);
  const intervalRef = useRef(null);

  const formatMinutes = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
  useEffect(() => {
    if (breakIntervalRef.current) {
      clearInterval(breakIntervalRef.current);
      breakIntervalRef.current = null;
    }

    // If not on break → no live timer
    if (!onBreak || !breakStartTime) {
      setLiveBreakMinutes(0);
      return;
    }

    const parsed = breakStartTime ? new Date(breakStartTime) : null;
    if (!parsed) return;

    const updateBreak = () => {
      const seconds = differenceInSeconds(new Date(), parsed);
      const minutes = Math.floor(seconds / 60);
      setLiveBreakMinutes(minutes);
    };

    updateBreak();
    breakIntervalRef.current = setInterval(updateBreak, 1000);

    return () => {
      if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    };
  }, [onBreak, breakStartTime]);

  return (
    <View
      style={{ width: "100%" }}
      className="px-4 py-4 bg-slate-200 rounded-xl justify-center items-center"
    >
      <View
        style={{ backgroundColor: COLORS.primary, width: "100%" }}
        className="h-60 rounded-lg px-3 justify-center items-center"
      >
        <View className="flex-row justify-between w-full h-40 items-center">
          {checkin ? (
            <View className="w-3/5 h-40 justify-center">
              <Text className="text-base text-white">Working from</Text>

              <Text className="text-lg font-bold text-white pb-1">
                {location?.locationName ?? "Office"}
              </Text>

              <Text className="text-base text-white">
                You have been working for
              </Text>

              <Text className="text-lg font-bold text-white">
                {formatMinutes(sessionMinutes)} Hours
              </Text>

              <Text className="text-sm text-orange-300 pt-1">
                Break time:{" "}
                {formatMinutes((breakMinutes ?? 0) + liveBreakMinutes)}
              </Text>
              {onBreak && (
                <Text className="text-xs text-red-300">On Break...</Text>
              )}

              <Text className="text-sm text-white pt-1">
                Today total: {todayTotal || "--:--"} Hours
              </Text>

              <Text className="text-sm text-white pt-1">
                Monthly total: {monthlyTotal || "--:--"} Hours
              </Text>
            </View>
          ) : (
            <View className="w-6/12 h-40 justify-center">
              <Text className="text-base text-white">Welcome Back!</Text>
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

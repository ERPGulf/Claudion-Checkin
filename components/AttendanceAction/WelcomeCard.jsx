import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { differenceInMinutes, format } from 'date-fns';
import { COLORS } from '../../constants';
import checkinimg from '../../assets/images/checkin.png';
import checkoutimg from '../../assets/images/checkout.png';
import {
  selectCheckin,
  selectCheckinTime,
  selectLocation,
} from '../../redux/Slices/AttendanceSlice';

function WelcomeCard() {
  const location = useSelector(selectLocation);
  const checkin = useSelector(selectCheckin);
  const checkinTime = useSelector(selectCheckinTime);
  const [minutes, setMinutes] = useState(null);

  function getMinutes() {
    const minutesDifference = differenceInMinutes(
      new Date(),
      new Date(checkinTime),
    );
    // Calculate the hours and remaining minutes
    const hours = Math.floor(minutesDifference / 60);
    const remainingMinutes = minutesDifference % 60;

    // Format the hours and minutes as "00:00" format
    return `${String(hours).padStart(2, '0')}:${String(
      remainingMinutes,
    ).padStart(2, '0')}`;
  }

  // Use a useEffect hook to refresh the minutes every 60 seconds
  useEffect(() => {
    // Function to update the minutes
    const updateMinutes = () => {
      setMinutes(getMinutes());
    };

    // Initial update on mount
    updateMinutes();

    // Set up the interval to update the minutes every 60 seconds
    const intervalId = setInterval(updateMinutes, 10000);

    // Clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, [checkin]);
  return (
    <View
      style={{ width: '100%' }}
      className="px-4 py-4 bg-slate-200 rounded-xl"
    >
      <View
        style={{ backgroundColor: COLORS.primary, width: '100%' }}
        className="h-40 rounded-lg px-3 w-full justify-center items-center"
      >
        <View className="flex-row justify-between w-full h-40 items-center">
          {checkin ? (
            <View className=" w-3/5 break-words h-40 justify-center">
              <Text className="text-base font-normal pt-1 text-white">
                Working from
              </Text>
              <Text className="text-lg font-bold text-white pb-1">
                {location}
              </Text>
              <Text className="text-base font-normal pt-1 text-white">
                You have been working for
              </Text>
              <Text className="text-lg  font-bold text-white">
                {minutes} Hours
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
            className=" h-24 w-24"
            contentFit="contain"
          />
        </View>
      </View>
    </View>
  );
}

export default WelcomeCard;
// import { View, Text } from "react-native";
// import { Image } from "expo-image";
// import React, { useEffect, useState } from "react";
// import { useSelector } from "react-redux";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { differenceInMinutes } from "date-fns";
// import { COLORS } from "../../constants";
// import checkinimg from "../../assets/images/checkin.png";
// import checkoutimg from "../../assets/images/checkout.png";
// import {
//   selectCheckin,
//   selectCheckinTime,
// } from "../../redux/Slices/AttendanceSlice";

// function WelcomeCard() {
//   const checkin = useSelector(selectCheckin);
//   const checkinTime = useSelector(selectCheckinTime);
//   const [workTime, setWorkTime] = useState("00:00");

//   const officeName = "My Office";

//   // Reset timer every month
//   const checkMonthlyReset = async () => {
//     const currentMonth = new Date().getMonth();
//     const savedMonth = await AsyncStorage.getItem("work_month");

//     if (savedMonth === null || Number(savedMonth) !== currentMonth) {
//       await AsyncStorage.setItem("work_month", String(currentMonth));
//       return true; // Reset needed
//     }
//     return false;
//   };

//   // Calculate HH:mm difference
//   const getWorkTime = () => {
//     if (!checkinTime) return "00:00";

//     const checkinDate = new Date(checkinTime);
//     if (isNaN(checkinDate.getTime())) return "00:00";

//     const now = new Date();
//     const minutesDifference = differenceInMinutes(now, checkinDate);
//     const hours = Math.floor(minutesDifference / 60);
//     const minutes = minutesDifference % 60;

//     return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
//   };

//   // Live Timer + Monthly Reset
//   useEffect(() => {
//     const updateTime = async () => {
//       const reset = await checkMonthlyReset();

//       if (reset) {
//         setWorkTime("00:00");
//       } else if (checkin) {
//         setWorkTime(getWorkTime());
//       } else {
//         setWorkTime("00:00");
//       }
//     };

//     updateTime();
//     const intervalId = setInterval(updateTime, 1000);

//     return () => clearInterval(intervalId);
//   }, [checkin, checkinTime]);

//   return (
//     <View
//       style={{ width: "100%" }}
//       className="px-4 py-4 bg-slate-200 rounded-xl"
//     >
//       <View
//         style={{ backgroundColor: COLORS.primary, width: "100%" }}
//         className="h-40 rounded-lg px-3 w-full justify-center items-center"
//       >
//         <View className="flex-row justify-between w-full h-40 items-center">
//           {checkin ? (
//             <View className="w-3/5 break-words h-40 justify-center">
//               <Text className="text-base font-normal pt-1 text-white">
//                 Working from
//               </Text>
//               <Text className="text-lg font-bold text-white pb-1">
//                 {officeName}
//               </Text>
//               <Text className="text-base font-normal pt-1 text-white">
//                 You have been working for
//               </Text>
//               <Text className="text-lg font-bold text-white">
//                 {workTime} Hours
//               </Text>
//             </View>
//           ) : (
//             <View className="w-6/12 h-40 justify-center">
//               <Text className="text-base font-normal pt-2 text-white">
//                 Welcome Back!
//               </Text>
//               <Text className="text-lg pt-2 font-bold text-white">
//                 Check-In before you start working
//               </Text>
//             </View>
//           )}
//           <Image
//             cachePolicy="memory-disk"
//             source={checkin ? checkoutimg : checkinimg}
//             className="h-24 w-24"
//             contentFit="contain"
//           />
//         </View>
//       </View>
//     </View>
//   );
// }

// export default WelcomeCard;

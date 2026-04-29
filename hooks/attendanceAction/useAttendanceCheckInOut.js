import { useCallback } from "react";
import { useDispatch } from "react-redux";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setCheckin, setCheckout } from "../../redux/Slices/AttendanceSlice";
import { userCheckIn, employeeBreak } from "../../services/api/attendance.service";

function useAttendanceCheckInOut({
  navigation,
  checkin,
  employeeCode,
  distanceInfo,
  restrictLocation,
  onBreak,
  refreshAttendanceData,
  syncBreakState,
  setActionLoading,
}) {
  const dispatch = useDispatch();

  const handleDirectCheckInOut = useCallback(
    async (type) => {
      try {
        setActionLoading(true);
        const response = await userCheckIn({
          employeeCode,
          type,
          locationData: distanceInfo,
        });

        if (!response.allowed) {
          Toast.show({
            type: "error",
            text1: ":warning: Action blocked",
            text2: response.message,
          });
          return;
        }

        if (type === "IN") {
          dispatch({ type: "attendance/setSelectedLocation", payload: null });
          dispatch(
            setCheckin({
              checkinTime: Date.now(),
              location: restrictLocation === "1" ? response.location : null,
            }),
          );
        } else {
          if (onBreak) {
            const breakRes = await employeeBreak({
              employeeCode,
              type: "OUT",
            });
            if (!breakRes?.allowed) {
              console.log("Break already ended from backend");
            }
          }

          dispatch(setCheckout({ checkoutTime: Date.now() }));
          dispatch({ type: "attendance/setSelectedLocation", payload: null });
        }

        const breakData = await refreshAttendanceData();
        await syncBreakState(breakData);

        Toast.show({
          type: "success",
          text1: type === "IN" ? "Checked in!" : "Checked out!",
        });
      } catch (error) {
        console.log("AttendanceAction.handleDirectCheckInOut error:", {
          errorMessage: error?.message,
          status: error?.response?.status,
          responseData: error?.response?.data,
        });

        Toast.show({
          type: "error",
          text1: ":warning: Failed",
          text2:
            error?.response?.data?.message ||
            error?.response?.data ||
            error.message ||
            "Request failed",
        });
      } finally {
        setActionLoading(false);
      }
    },
    [
      dispatch,
      distanceInfo,
      employeeCode,
      onBreak,
      refreshAttendanceData,
      restrictLocation,
      setActionLoading,
      syncBreakState,
    ],
  );

  const handleCheckInOutPress = useCallback(async () => {
    try {
      const photoValue = await AsyncStorage.getItem("photo");
      const actionType = checkin ? "OUT" : "IN";

      if (photoValue !== "1") {
        await handleDirectCheckInOut(actionType);
      } else {
        navigation.navigate("Attendance camera", {
          type: actionType,
        });
      }
    } catch (error) {
      Toast.show({
        type: "error",
        text1: ":warning: Action failed",
        text2: error.message,
      });
    }
  }, [checkin, handleDirectCheckInOut, navigation]);

  return {
    handleCheckInOutPress,
  };
}

export default useAttendanceCheckInOut;

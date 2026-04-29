import { useCallback } from "react";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveTokens } from "../../services/api/apiClient";

function useAttendanceDevActions() {
  const handleInvalidateAccessToken = useCallback(async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("refresh_token");

      if (!refreshToken) {
        Toast.show({
          type: "error",
          text1: "Refresh token missing",
          text2: "Cannot invalidate access token without a refresh token.",
        });
        return;
      }

      await saveTokens("invalid-access-token-123", refreshToken);
      const maskedRefresh = `${refreshToken.slice(0, 6)}...${refreshToken.slice(-4)}`;
      Toast.show({
        type: "success",
        text1: "Dev token invalidated",
        text2: `Refresh token preserved: ${maskedRefresh}`,
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Dev token reset failed",
        text2: error.message || "Unable to invalidate access token.",
      });
    }
  }, []);

  return {
    handleInvalidateAccessToken,
  };
}

export default useAttendanceDevActions;

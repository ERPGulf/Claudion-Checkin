import * as Location from "expo-location";
import { Toast } from "react-native-toast-message/lib/src/Toast";

export const requestLocationAccess = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      Toast.show({
        type: "error",
        text1: "Location Permission Denied",
        text2: "Enable location to continue.",
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Location permission error:", err);
    return false;
  }
};

export const getPreciseCoordinates = async () => {
  try {
    const result = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
    };
  } catch (err) {
    console.error("Error getting GPS position:", err);
    Toast.show({
      type: "error",
      text1: "Unable to fetch location",
    });
    return null;
  }
};

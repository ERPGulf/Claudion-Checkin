import * as Location from "expo-location";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { hapticsMessage } from "./HapticsMessage";
export const useLocationForegroundAccess = async () => {
  try {
    Toast.show({
      type: "info",
      text1: "Requesting location access",
      autoHide: true,
      visibilityTime: 2000,
    });

    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      hapticsMessage("error");
      Toast.show({
        type: "error",
        text1: "Location access not granted",
        text2: "Please enable location access to continue",
        autoHide: true,
        visibilityTime: 3000,
      });
      return false; // explicitly return false
    }

    // Permission granted
    hapticsMessage("success");
    Toast.show({
      type: "success",
      text1: "Location access granted",
      autoHide: true,
      visibilityTime: 3000,
    });
    return true; // explicitly return true
  } catch (error) {
    console.error("Location permission error:", error);
    hapticsMessage("error");
    Toast.show({
      type: "error",
      text1: "Location access failed",
      autoHide: true,
      visibilityTime: 3000,
    });
    return false;
  }
};


export const getPreciseCoordinates = async () => {
  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation, // more precise for check-in
    });

    const { latitude, longitude } = location.coords;
    return { latitude, longitude };
  } catch (error) {
    console.error("Precise coordinates error:", error);
    Toast.show({
      type: "error",
      text1: "Unable to retrieve location",
      autoHide: true,
      visibilityTime: 3000,
    });
    return null; // explicit null return if location fails
  }
};

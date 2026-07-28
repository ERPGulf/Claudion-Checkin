import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { useNavigation } from "@react-navigation/native";
import { format } from "date-fns";
import { COLORS, SIZES } from "../constants";
import {
  selectCheckin,
  setCheckin,
  setCheckout,
} from "../redux/Slices/AttendanceSlice";
import { selectIsWfh, setFileid } from "../redux/Slices/UserSlice";
import { hapticsMessage } from "../utils/HapticsMessage";
import {
  putUserFile,
  userCheckIn,
  userFileUpload,
  userStatusPut,
  getOfficeLocation,
} from "../services/api";
import {
  performSessionTransition,
  SESSION_ORIGIN,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";

function AttendanceCamera() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Attendance Camera",
      headerTitleAlign: "center",
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState("front");
  const [mode, setMode] = useState("camera");
  const [photo, setPhoto] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const checkin = useSelector(selectCheckin);
  const { employeeCode } = useSelector((state) => state.user.userDetails);
  const isWFH = useSelector(selectIsWfh);
  const currentDate = new Date().toISOString();
  const cameraRef = useRef();

  const toggleCameraFacing = () => {
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  const changeMode = () => {
    setMode(mode === "camera" ? "video" : "camera");
  };

  const takePicture = async () => {
    try {
      if (!cameraRef.current) {
        return;
      }

      const newPhoto = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        skipProcessing: true,
        base64: false,
      });

      setPhoto(newPhoto);
    } catch (error) {
      Toast.show({ type: "error", text1: "Photo capture failed" });
    }
  };

  // ✅ CHECK-IN / CHECK-OUT HANDLER
  const handleChecking = async (type, custom_in) => {
    try {
      setIsLoading(true);

      // 📍 GET OFFICE LOCATION FIRST
      // Read restrict_location
      const restrictLocation = (
        await AsyncStorage.getItem("restrict_location")
      )?.trim();

      const unrestrictedCheckout = (
        await AsyncStorage.getItem("unrestricted_checkout_location")
      )?.trim();

      const shouldSkipLocationRestriction =
        type === "OUT" && unrestrictedCheckout === "1";

      // 📍 Only call location API if restriction is enabled
      let locationData = null;
      if (!shouldSkipLocationRestriction && restrictLocation === "1") {
        locationData = await getOfficeLocation(employeeCode);

        // If not within radius, block
        if (locationData && !locationData.withinRadius) {
          Toast.show({
            type: "error",
            text1: "Location Error",
            text2: `You are ${locationData.distance}m away. Allowed: ${locationData.radius}m`,
          });
          return;
        }
      }

      const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");

      const dataField = {
        employeeCode,
        type,
        timestamp,
        location: locationData?.locationName, // <--- send location string
        distance: locationData?.distance || 0,
        radius: locationData?.radius || 0,
      };

      // Same session state machine the geofence drives, so a photo check-in is
      // an ordinary open session that an office EXIT can close automatically.
      const outcome = await performSessionTransition({
        type,
        origin: SESSION_ORIGIN.MANUAL,
        execute: () => userCheckIn(dataField),
      });

      if (outcome.status === TRANSITION_RESULT.SKIPPED) {
        // Already in the target state (e.g. an automatic check-out landed while
        // the camera was open). Nothing was sent; re-sync and go back.
        const { session } = outcome;
        if (session.status === SESSION_STATUS.CHECKED_IN) {
          dispatch(
            setCheckin({
              checkinTime: session.startedAt,
              location: null,
              sessionOrigin: session.origin,
            }),
          );
        } else {
          dispatch(setCheckout({ checkoutTime: session.endedAt }));
        }

        Toast.show({
          type: "info",
          text1:
            session.status === SESSION_STATUS.CHECKED_IN
              ? "Already checked in"
              : "Already checked out",
          text2:
            session.closedBy === SESSION_ORIGIN.AUTO
              ? "You were checked out automatically when you left the office."
              : undefined,
        });
        navigation.navigate("Attendance action");
        return;
      }

      if (outcome.status === TRANSITION_RESULT.FAILED) {
        throw new Error(outcome.response?.message || "Check-in failed");
      }

      const { session } = outcome;
      const docname = outcome.response?.name;
      if (!docname) throw new Error("Check-in failed: Missing Checkin ID");

      // Redux update. The attendance log now exists on the server, so the
      // session is committed before the photo work: if the upload fails the
      // user is still checked in/out, both here and for the geofence.
      if (custom_in === 1) {
        dispatch(
          setCheckin({
            checkinTime: session.startedAt,
            location: {
              locationName: locationData?.locationName || "Office",
              latitude: locationData?.latitude,
              longitude: locationData?.longitude,
              radius: locationData?.radius,
            },
            sessionOrigin: session.origin,
          }),
        );
      } else {
        dispatch(setCheckout({ checkoutTime: session.endedAt }));
      }

      try {
        // Update employee status
        await userStatusPut(employeeCode, custom_in);
        // Upload photo
        await uploadPicture(docname);
      } catch (uploadError) {
        Toast.show({
          type: "error",
          text1: `CHECKED ${type}, photo not saved`,
          text2: uploadError.message,
        });
        navigation.navigate("Attendance action");
        return;
      }

      hapticsMessage("success");
      Toast.show({
        type: "success",
        text1: `CHECKED ${type}`,
      });

      navigation.navigate("Attendance action");
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Check-in failed",
        text2: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ UPLOAD PHOTO FUNCTION
  const uploadPicture = async (docname) => {
    try {
      if (!photo?.uri) throw new Error("No photo available for upload");

      Toast.show({
        type: "info",
        text1: "Uploading photo...",
        autoHide: true,
        visibilityTime: 2000,
      });

      const file = {
        uri: photo.uri,
        name: `${docname}_${Date.now()}.jpg`,
        type: "image/jpeg",
      };

      // 1️⃣ Upload photo to ERP
      const uploadResponse = await userFileUpload(file, docname);

      // The API returns: { message: ["/files/yourfile.png"] }
      const uploadedFileUrl = uploadResponse?.message?.[0];
      if (!uploadedFileUrl)
        throw new Error("Upload failed: No file URL received");

      // 2️⃣ Update custom_image field in Employee Checkin doctype
      const updateFormData = new FormData();
      updateFormData.append("custom_image", uploadedFileUrl);
      await putUserFile(updateFormData, docname);
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Photo Upload Failed",
        text2: error.message || "Unknown error",
      });
      throw error;
    }
  };

  if (!permission)
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
        <Text>Loading camera...</Text>
      </SafeAreaView>
    );

  if (!permission.granted)
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text className="text-center mb-4">
          We need your permission to show the camera
        </Text>
        <TouchableOpacity
          onPress={requestPermission}
          className="bg-blue-500 px-4 py-2 rounded"
        >
          <Text className="text-white">Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );

  if (photo)
    return (
      <View
        style={{ paddingTop: Constants.statusBarHeight, paddingBottom: 20 }}
        className="flex-1 items-center justify-center bg-white"
      >
        <View className="w-full border-b border-black/30 px-3">
          <View className="flex-row pb-4 pt-2 items-center justify-center relative">
            <TouchableOpacity
              className="absolute left-0"
              // onPress={() => setPhoto(null)}
              onPress={() => {
                setPhoto(null);
                setTimeout(() => {}, 120);
              }}
            >
              <Text className="text-base text-red-500">Retake</Text>
            </TouchableOpacity>
            <Text className="text-xl font-medium">Preview</Text>
          </View>
        </View>

        <View style={{ width: SIZES.width }} className="flex-1 px-3 bg-white">
          <Image
            cachePolicy="disk"
            contentFit="cover"
            style={{
              width: "100%",
              height: "100%",
              flex: 1,
              borderRadius: 12,
              marginVertical: 12,
            }}
            // source={{ uri: `data:image/jpg;base64,${photo.base64}` }}
            source={{ uri: photo.uri }}
          />
          <View className="w-full items-center justify-center">
            {checkin ? (
              <TouchableOpacity
                className="justify-center items-center mb-3 bg-blue-500 w-full h-16 rounded-2xl"
                onPress={() => handleChecking("OUT", 0)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="large" color="white" />
                ) : (
                  <Text className="text-lg font-semibold text-white">
                    CHECK OUT
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                className="justify-center items-center mb-3 bg-blue-500 w-full h-16 rounded-2xl"
                onPress={() => handleChecking("IN", 1)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="large" color="white" />
                ) : (
                  <Text className="text-lg font-semibold text-white">
                    CHECK IN
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <CameraView facing={facing} ref={cameraRef} style={{ flex: 1 }} />
      <View
        style={{
          position: "absolute",
          top: Constants.statusBarHeight,
          left: 12,
          zIndex: 1,
        }}
      >
        <Ionicons
          name="chevron-back"
          color="white"
          size={SIZES.xxxLarge - SIZES.xSmall}
          onPress={() => navigation.goBack()}
        />
      </View>

      <View
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          zIndex: 1,
        }}
        className="flex-row items-center justify-center w-full px-3"
      >
        <TouchableOpacity
          onPress={takePicture}
          style={{ width: 80, height: 80 }}
          className="bg-white justify-center items-center rounded-full"
        >
          <Ionicons name="camera" size={40} color="black" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleCameraFacing}
          style={{ width: 80, height: 80, position: "absolute", left: 16 }}
          className="justify-center items-center rounded-full"
        >
          <Ionicons name="refresh" size={44} color="white" />
        </TouchableOpacity>

        <TouchableOpacity
          disabled={mode === "camera"}
          onPress={changeMode}
          style={{ width: 80, height: 80, position: "absolute", right: 16 }}
          className="justify-center items-center rounded-full"
        >
          <Ionicons
            name={mode === "camera" ? "videocam" : "camera"}
            size={44}
            color={mode === "camera" ? "grey" : "white"}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default AttendanceCamera;

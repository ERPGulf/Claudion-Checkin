import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import React, { useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { useNavigation } from "@react-navigation/native";
import { format } from "date-fns";
import { RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import ActionButton from "../components/common/ActionButton";
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
} from "../services/api";
import {
  performSessionTransition,
  SESSION_ORIGIN,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";
import { submitManualAttendance } from "../services/offline/AttendanceQueueService";
import { resolveNearestOffice } from "../services/offline/offlineAttendanceGate";

function AttendanceCamera() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { colors } = useAppTheme();
  // The themed stack header — the one back button on this screen.
  useModernScreenHeader("Attendance Camera");
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState("front");
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
    const failedTitle = type === "IN" ? "Check-in failed" : "Check-out failed";

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

      // 📍 Only resolve the location if restriction is enabled.
      // `resolveNearestOffice` falls back to the cached configuration when
      // offline; the previous `getOfficeLocation` threw, and the throw surfaced
      // as "Check-in failed" before the offline queue was ever reached.
      let locationData = null;
      if (!shouldSkipLocationRestriction && restrictLocation === "1") {
        locationData = await resolveNearestOffice(employeeCode);

        // If not within radius, block
        if (locationData && !locationData.withinRadius) {
          hapticsMessage("error");
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
      //
      // Online only — a manual punch is never queued, so either the server
      // records it and names the document this photo attaches to, or nothing
      // happened and the catch below says so.
      const outcome = await performSessionTransition({
        type,
        origin: SESSION_ORIGIN.MANUAL,
        execute: () =>
          submitManualAttendance({
            type,
            employeeCode,
            online: () => userCheckIn(dataField),
          }),
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

      // `outcome.response.message` is the curated refusal (out of radius, the
      // manual-offline notice…) — the one failure text meant for the employee.
      if (outcome.status === TRANSITION_RESULT.FAILED) {
        hapticsMessage("error");
        Toast.show({
          type: "error",
          text1: failedTitle,
          text2: outcome.response?.message,
        });
        return;
      }

      const { session } = outcome;
      const docname = outcome.response?.name;

      // The server accepted the request but answered without naming the record,
      // so there is nothing for the photo to attach to.
      if (!docname) {
        throw new Error("Check-in failed: Missing Checkin ID");
      }

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
        console.log("AttendanceCamera photo upload failed:", uploadError?.message);
        hapticsMessage("warning");
        Toast.show({
          type: "error",
          text1:
            type === "IN"
              ? "Checked in — photo not saved"
              : "Checked out — photo not saved",
          text2: "Your attendance was recorded without the photo.",
        });
        navigation.navigate("Attendance action");
        return;
      }

      hapticsMessage("success");
      Toast.show({
        type: "success",
        text1: type === "IN" ? "Checked in" : "Checked out",
      });

      navigation.navigate("Attendance action");
    } catch (error) {
      // Raw error text (network, native, JS) stays in the log.
      console.log("AttendanceCamera.handleChecking error:", error?.message);
      hapticsMessage("error");
      Toast.show({
        type: "error",
        text1: failedTitle,
        text2: "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ UPLOAD PHOTO FUNCTION
  // Throws on failure; the caller owns the one toast for the outcome.
  const uploadPicture = async (docname) => {
    if (!photo?.uri) throw new Error("No photo available for upload");

    const file = {
      uri: photo.uri,
      name: `${docname}_${Date.now()}.jpg`,
      type: "image/jpeg",
    };

    // 1️⃣ Upload photo to ERP
    const uploadResponse = await userFileUpload(file, docname);

    // The API returns: { message: ["/files/yourfile.png"] }
    const uploadedFileUrl = uploadResponse?.message?.[0];
    if (!uploadedFileUrl) throw new Error("Upload failed: No file URL received");

    // 2️⃣ Update custom_image field in Employee Checkin doctype
    const updateFormData = new FormData();
    updateFormData.append("custom_image", uploadedFileUrl);
    await putUserFile(updateFormData, docname);
  };

  const page = { flex: 1, backgroundColor: colors.surfaceSecondary };

  if (!permission)
    return (
      <SafeAreaView
        style={[page, { alignItems: "center", justifyContent: "center" }]}
        edges={["bottom", "left", "right"]}
      >
        <ActivityIndicator size="large" color={colors.textMuted} />
        <Text
          style={{
            ...TYPO.subhead,
            color: colors.textMuted,
            marginTop: SPACING.sm,
          }}
        >
          Loading camera...
        </Text>
      </SafeAreaView>
    );

  if (!permission.granted)
    return (
      <SafeAreaView
        style={[page, { justifyContent: "center", padding: SPACING.lg }]}
        edges={["bottom", "left", "right"]}
      >
        <Text
          style={{
            ...TYPO.body,
            color: colors.textPrimary,
            textAlign: "center",
            marginBottom: SPACING.lg,
          }}
        >
          We need your permission to show the camera
        </Text>
        {/* Once the OS stops asking, the request resolves silently — only
            Settings can grant it then. */}
        {permission.canAskAgain ? (
          <ActionButton
            icon="camera-outline"
            label="Allow camera"
            onPress={requestPermission}
          />
        ) : (
          <ActionButton
            icon="settings-outline"
            label="Open Settings"
            onPress={() => Linking.openSettings()}
          />
        )}
      </SafeAreaView>
    );

  if (photo)
    return (
      <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: SPACING.md,
            paddingTop: SPACING.sm,
            paddingBottom: SPACING.lg,
            borderBottomWidth: 1,
            borderBottomColor: colors.dividerSubtle,
          }}
        >
          <TouchableOpacity
            style={{ position: "absolute", left: SPACING.md }}
            onPress={() => setPhoto(null)}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityState={{ disabled: isLoading }}
          >
            <Text
              style={{
                ...TYPO.body,
                color: isLoading ? colors.textMuted : colors.errorText,
              }}
            >
              Retake
            </Text>
          </TouchableOpacity>
          <Text style={{ ...TYPO.title3, color: colors.textPrimary }}>
            Preview
          </Text>
        </View>

        <View style={{ flex: 1, paddingHorizontal: SPACING.md }}>
          <Image
            cachePolicy="disk"
            contentFit="cover"
            style={{
              width: "100%",
              height: "100%",
              flex: 1,
              borderRadius: RADIUS.md,
              marginVertical: SPACING.md,
            }}
            source={{ uri: photo.uri }}
          />
          <ActionButton
            size="lg"
            icon={checkin ? "log-out-outline" : "log-in-outline"}
            label={checkin ? "Check out" : "Check in"}
            loading={isLoading}
            onPress={() =>
              checkin ? handleChecking("OUT", 0) : handleChecking("IN", 1)
            }
            style={{ marginBottom: SPACING.md }}
          />
        </View>
      </SafeAreaView>
    );

  return (
    <View style={{ flex: 1 }}>
      <CameraView facing={facing} ref={cameraRef} style={{ flex: 1 }} />

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
        {/* White over the live feed in both themes — this chrome sits on the
            camera image, not on an app surface. */}
        <TouchableOpacity
          onPress={takePicture}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          style={{ width: 80, height: 80 }}
          className="bg-white justify-center items-center rounded-full"
        >
          <Ionicons name="camera" size={40} color="black" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleCameraFacing}
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          style={{ width: 80, height: 80, position: "absolute", left: 16 }}
          className="justify-center items-center rounded-full"
        >
          <Ionicons name="refresh" size={44} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default AttendanceCamera;

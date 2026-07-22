// Local (on-device) notifications — distinct from FCM remote push in
// fcm.service.js. Used by automatic attendance to alert the user when the
// office geofence checks them out. Fires whenever the JS context is alive
// (foreground or backgrounded-but-alive) — the same states in which automatic
// check-out itself runs.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const LOG_PREFIX = "[localNotifications]";
const ATTENDANCE_CHANNEL_ID = "attendance";

// Without a handler, expo-notifications suppresses the banner while the app is
// foregrounded. This governs only expo-notifications' own local notifications —
// it does not affect FCM, which is a separate native module.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(ATTENDANCE_CHANNEL_ID, {
      name: "Attendance",
      importance: Notifications.AndroidImportance.HIGH,
    });
    channelReady = true;
  } catch (error) {
    console.log(`${LOG_PREFIX} Failed to create channel:`, error?.message);
  }
}

/**
 * Ensure OS notification permission (Android 13 POST_NOTIFICATIONS / iOS) and
 * the Android channel exist. Safe to call repeatedly; best invoked from the
 * foreground (e.g. when the user enables automatic attendance) so the OS prompt
 * can actually appear. Returns whether notifications are permitted.
 */
export async function ensureNotificationSetup() {
  try {
    await ensureAndroidChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch (error) {
    console.log(`${LOG_PREFIX} Permission setup failed:`, error?.message);
    return false;
  }
}

/**
 * Present a local notification immediately. Silently no-ops (logging only) if
 * notifications aren't permitted — a missing alert must never break check-out.
 * @param {{title: string, body: string, data?: object}} options
 */
export async function presentLocalNotification({ title, body, data = {} }) {
  try {
    const granted = await ensureNotificationSetup();
    if (!granted) {
      console.log(`${LOG_PREFIX} Notifications not permitted; skipping alert`);
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: true },
      // `{ channelId }` delivers immediately on the given Android channel; iOS
      // has no channels, so a null trigger delivers immediately there.
      trigger:
        Platform.OS === "android" ? { channelId: ATTENDANCE_CHANNEL_ID } : null,
    });
  } catch (error) {
    console.log(`${LOG_PREFIX} Failed to present notification:`, error?.message);
  }
}

export default {
  ensureNotificationSetup,
  presentLocalNotification,
};

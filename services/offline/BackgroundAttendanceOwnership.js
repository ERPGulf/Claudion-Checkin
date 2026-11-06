import { AppState, Platform } from "react-native";

let iosLocationWake = false;

/** Keep background UI triggers deferred even after this wake expires. Only a
 * later native callback may grant another lease; foreground resumes normal UI.
 * FCM-only starts and older binaries retain their existing bootstrap behavior.
 */
export const noteIOSAttendanceWake = () => { iosLocationWake = true; };

export const deferToIOSAttendanceWake = () => {
  if (Platform.OS !== "ios") return false;
  if (AppState.currentState === "active") {
    iosLocationWake = false;
    return false;
  }
  return iosLocationWake;
};

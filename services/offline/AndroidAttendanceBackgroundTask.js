import { AppRegistry, Platform } from "react-native";
import { completeBackgroundSync, isBackgroundSyncActive } from "../../modules/expo-auto-attendance";
import { runAttendanceBackgroundSync } from "./AttendanceBackgroundSync";

export const ANDROID_ATTENDANCE_TASK = "ClaudionAttendanceSync";
// Native's 150s worker deadline leaves time for completion after this budget.
export const BACKGROUND_SYNC_BUDGET_MS = 100000;

/** The native worker starts the shared processors without mounting a React root. */
export const runAndroidAttendanceBackgroundSync = async ({ runId } = {}) => {
  let retry = true;
  try {
    const result = await runAttendanceBackgroundSync({
      trigger: "android-worker",
      budgetMs: BACKGROUND_SYNC_BUDGET_MS,
      // onStopped()/finishTask() do not cancel JS Promises. The existing scope
      // guards must reject continuations once this exact native pass has ended.
      // Older binaries return null and retain the shared runner's own deadline.
      isCancelled: () => isBackgroundSyncActive(runId) === false,
    });
    retry = result.retry;
    return result;
  } finally {
    try { completeBackgroundSync(runId, retry); }
    catch { /* Native's conservative timeout retains retry if completion fails. */ }
  }
};

// App.js is evaluated by Android's ReactHost before any React root is mounted.
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask(ANDROID_ATTENDANCE_TASK, () => runAndroidAttendanceBackgroundSync);
}

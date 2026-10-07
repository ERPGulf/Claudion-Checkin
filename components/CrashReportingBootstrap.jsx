import { useEffect } from "react";
import { useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import useHomeExperience from "../hooks/useHomeExperience";
import {
  clearCrashUser,
  setCrashAttributes,
  setCrashUser,
} from "../services/crashlytics.service";

/**
 * Keeps Crashlytics' user context in step with the session, following the
 * bootstrap convention of <FcmBootstrap> and <FeatureSettingsBootstrap>.
 *
 * Driven by `isLoggedIn` rather than by the sign-in screens, so the three
 * sign-in paths (QR, legacy QR, mobile), both sign-out paths (Profile and a
 * forced session expiry) and a relaunch into a persisted session all pass
 * through here.
 */
export default function CrashReportingBootstrap() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const employeeCode = useSelector(selectEmployeeCode);
  // TEMPORARY: New Home Experience experiment. Both variants share route
  // names, so the screen key alone cannot say which one crashed.
  const { enabled: newHomeEnabled } = useHomeExperience();

  useEffect(() => {
    if (!isLoggedIn) {
      clearCrashUser();
      return;
    }

    // Storage is the source of truth for the session's tenant and employee;
    // see services/api/authHelper.js.
    let cancelled = false;
    AsyncStorage.multiGet(["employee_code", "baseUrl", "auth_method"])
      .then((entries) => {
        // A sign-out during the read has already cleared the user.
        if (cancelled) return;
        const stored = Object.fromEntries(entries);
        return setCrashUser({
          employeeId: stored.employee_code,
          tenantUrl: stored.baseUrl,
          authMethod: stored.auth_method,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, employeeCode]);

  useEffect(() => {
    setCrashAttributes({ ui_mode: newHomeEnabled ? "new" : "legacy" });
  }, [newHomeEnabled]);

  return null;
}

import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectFeatureSettingsFetchedAt } from "../redux/Slices/FeatureSettingsSlice";
import {
  locationAccessDeclined,
  requestAutoAttendanceSync,
  selectAutoAttendanceConfigured,
  selectAutoAttendanceDeclinedLocationAccess,
  selectAutoAttendanceScope,
} from "../redux/Slices/AutoAttendanceSlice";
import { isAvailable } from "../modules/expo-auto-attendance";
import { askForLocationAccess, locationAccessKey } from "../utils/autoAttendance";

/**
 * Asks for the location access automatic attendance needs, once the employer
 * has enabled it for this employee.
 *
 * Only on settings and employee policy received since launch — a persisted
 * answer may have been withdrawn, and this asks for background location — and
 * only in the foreground, so a background (geofence) launch never prompts. The
 * OS permission state decides every time: granted or no longer askable shows
 * nothing, and a state the employee declined in is not asked about again until
 * it changes. The Automatic attendance screen retries on request.
 */
export default function AutoAttendanceOnboarding() {
  const dispatch = useDispatch();
  const [startedAt] = useState(Date.now);
  const [appState, setAppState] = useState(AppState.currentState);
  const scope = useSelector(selectAutoAttendanceScope);
  const declined = useSelector(selectAutoAttendanceDeclinedLocationAccess);
  const due = useSelector((state) => {
    const policy = state.autoAttendance?.employeePolicy;
    return selectIsLoggedIn(state) && selectAutoAttendanceConfigured(state) &&
      (selectFeatureSettingsFetchedAt(state) ?? 0) >= startedAt &&
      policy?.source === "response" && (policy.receivedAt ?? 0) >= startedAt;
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!due || !scope || appState !== "active" || !isAvailable()) return;
    askForLocationAccess({ unless: (access) => locationAccessKey(access) === declined })
      .then((access) => {
        if (!access.asked) return;
        // The bootstraps checked before permission existed; have them register now.
        if (access.granted) dispatch(requestAutoAttendanceSync());
        else dispatch(locationAccessDeclined({ scope, key: locationAccessKey(access) }));
      })
      .catch((error) => console.log("[AutoAttendance] Onboarding failed:", error?.message));
  }, [due, scope, declined, appState, dispatch]);

  return null;
}

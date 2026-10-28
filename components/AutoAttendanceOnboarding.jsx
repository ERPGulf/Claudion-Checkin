import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import {
  selectFeatureSettingsFetchedAt,
  selectFeatureSettingsScope,
} from "../redux/Slices/FeatureSettingsSlice";
import {
  locationOnboardingAnswered,
  locationOnboardingReset,
  requestAutoAttendanceSync,
  selectAutoAttendanceConfigured,
  selectAutoAttendanceScope,
  selectLocationOnboardingAnswered,
} from "../redux/Slices/AutoAttendanceSlice";
import { isAvailable } from "../modules/expo-auto-attendance";
import { askForLocationAccess } from "../utils/autoAttendance";
import LocationAccessExplainer from "./AutoAttendance/LocationAccessExplainer";

/**
 * Explains, once per account, the location access automatic attendance needs,
 * after the employer has enabled it for this employee — and hosts that
 * explanation for the Automatic attendance screen too.
 *
 * Only on settings and employee policy received for this account since launch
 * — a persisted answer may have been withdrawn, and this asks for background
 * location — and only in the foreground, so a background (geofence) launch
 * never prompts. The OS permission state decides every time: granted or no
 * longer askable shows nothing. Once the employee answers (Continue or Not
 * now), it does not open by itself again; the Automatic attendance screen shows
 * the status and retries on request. A fresh answer that makes the account
 * ineligible forgets that, so becoming eligible again is evaluated afresh.
 */
export default function AutoAttendanceOnboarding() {
  const dispatch = useDispatch();
  const [startedAt] = useState(Date.now);
  const [appState, setAppState] = useState(AppState.currentState);
  const scope = useSelector(selectAutoAttendanceScope);
  const answered = useSelector(selectLocationOnboardingAnswered);
  const configured = useSelector((state) =>
    selectIsLoggedIn(state) && selectAutoAttendanceConfigured(state));
  const verified = useSelector((state) => {
    const policy = state.autoAttendance?.employeePolicy;
    return !!scope && selectFeatureSettingsScope(state) === scope &&
      (selectFeatureSettingsFetchedAt(state) ?? 0) >= startedAt &&
      policy?.source === "response" && policy.scope === scope &&
      (policy.receivedAt ?? 0) >= startedAt;
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (verified && !configured && answered) dispatch(locationOnboardingReset({ scope }));
  }, [verified, configured, answered, scope, dispatch]);

  useEffect(() => {
    if (!verified || !configured || answered || appState !== "active" || !isAvailable()) return;
    askForLocationAccess()
      .then((access) => {
        if (!access.asked) return;
        dispatch(locationOnboardingAnswered({ scope }));
        // The bootstraps checked before permission existed; have them register now.
        if (access.granted) dispatch(requestAutoAttendanceSync());
      })
      .catch((error) => console.log("[AutoAttendance] Onboarding failed:", error?.message));
  }, [verified, configured, answered, scope, appState, dispatch]);

  return <LocationAccessExplainer />;
}

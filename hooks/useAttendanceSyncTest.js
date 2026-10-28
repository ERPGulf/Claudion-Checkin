import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectBaseUrl, selectEmployeeCode } from "../redux/Slices/UserSlice";
import { selectAutoAttendanceConfigured } from "../redux/Slices/AutoAttendanceSlice";
import { useFeatureEnabled } from "./useFeatureSettings";
import { ATTENDANCE_FEATURES } from "../utils/featureSettings";
import { addAttendanceSyncTestPair, canUseAttendanceSyncTest } from "../services/offline/AttendanceSyncTestService";
import { assertAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";

export default function useAttendanceSyncTest() {
  const loggedIn = useSelector(selectIsLoggedIn);
  const employeeId = useSelector(selectEmployeeCode);
  const tenantKey = useSelector(selectBaseUrl);
  const automatic = useSelector(selectAutoAttendanceConfigured);
  const offline = useFeatureEnabled(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE);
  const identity = JSON.stringify([loggedIn, employeeId, tenantKey]);
  const latest = useRef(identity);
  latest.current = identity;
  const mounted = useRef(false);
  const pressed = useRef(false);
  const [state, setState] = useState({ identity, busy: null, result: null, error: null });
  useEffect(() => {
    mounted.current = true;
    setState({ identity, busy: null, result: null, error: null });
    return () => { mounted.current = false; };
  }, [identity]);
  const visible = loggedIn && canUseAttendanceSyncTest();
  const enabled = visible && !!employeeId && !!tenantKey && automatic && offline;
  const current = () => mounted.current && latest.current === identity;
  const add = async mode => {
    if (!enabled || pressed.current) return;
    pressed.current = true;
    setState({ identity, busy: mode, result: null, error: null });
    try {
      const result = await addAttendanceSyncTestPair({ mode, employeeId, tenantKey, isCancelled: () => !current() });
      await assertAttendanceQueueScope(result.scope);
      if (current()) setState({ identity, busy: null, result, error: null });
    } catch (error) {
      if (current()) setState({ identity, busy: null, result: null,
        error: ["FEATURE_DISABLED", "EMPLOYEE_AUTO_ATTENDANCE_DISABLED", "EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE"].includes(error?.code)
          ? "Automatic and offline attendance must be enabled for this employee."
          : error?.code === "ATTENDANCE_SYNC_TEST" ? error.message
          : "Could not finish adding the test pair. Check Attendance recovery before trying again." });
    } finally {
      pressed.current = false;
    }
  };
  const safe = state.identity === identity ? state : { busy: null, result: null, error: null };
  return { ...safe, visible, enabled, employeeId, tenantKey, add };
}

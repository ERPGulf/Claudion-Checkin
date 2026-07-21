import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as Location from "expo-location";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import {
  AUTO_ATTENDANCE_MODES,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceMode,
} from "../redux/Slices/AutoAttendanceSlice";
import { setCheckin, setCheckout } from "../redux/Slices/AttendanceSlice";
import {
  persistCheckinStartTime,
  persistCheckoutTime,
} from "../utils/attendanceSession";
import { getOfficeLocation, userCheckIn } from "../services/api/attendance.service";
import {
  addGeofenceEnterListener,
  addGeofenceExitListener,
  isAvailable,
  isMonitoring,
  OFFICE_GEOFENCE_IDENTIFIER,
  startGeofence,
  stopGeofence,
} from "../modules/expo-auto-attendance";

const LOG_PREFIX = "[AutoAttendanceBootstrap]";

/**
 * Keeps automatic check-in/out working regardless of which screen is open.
 *
 * The AutoAttendance screen only handles the user-facing settings and the
 * initial (permission-requesting) start/stop; this component's job is to:
 *  - re-attach the geofence ENTER/EXIT listeners on every app launch/login,
 *    since those are JS-side and don't survive a JS engine restart even
 *    though the native geofence registration itself does, and
 *  - perform the real check-in/checkout API call when "full actions" mode
 *    is selected, so it fires from anywhere in the app, not just while the
 *    AutoAttendance screen happens to be mounted.
 *
 * Registration is only (re-)established here if location permission is
 * already granted — this component runs on login, with no user gesture, so
 * it must never trigger a permission prompt itself (that only happens when
 * the user explicitly picks a mode on the AutoAttendance screen).
 */
export default function AutoAttendanceBootstrap() {
  const dispatch = useDispatch();
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const mode = useSelector(selectAutoAttendanceMode);
  const fullActions = useSelector(selectAutoAttendanceFullActions);
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode,
  );

  // Read inside the listener closures without re-subscribing on every change.
  const fullActionsRef = useRef(fullActions);
  fullActionsRef.current = fullActions;
  const employeeCodeRef = useRef(employeeCode);
  employeeCodeRef.current = employeeCode;

  useEffect(() => {
    if (!isAvailable()) return undefined;

    if (!isLoggedIn || mode === AUTO_ATTENDANCE_MODES.DISABLED) {
      stopGeofence().catch(() => {});
      return undefined;
    }

    if (!employeeCode) return undefined;

    let cancelled = false;

    const performAttendanceAction = async (type) => {
      if (!fullActionsRef.current) return;
      const code = employeeCodeRef.current;
      if (!code) return;

      try {
        const response = await userCheckIn({ employeeCode: code, type });
        if (!response.allowed) {
          console.log(`${LOG_PREFIX} Auto ${type} blocked:`, response.message);
          return;
        }

        if (type === "IN") {
          const startedAt = await persistCheckinStartTime(Date.now());
          dispatch(
            setCheckin({ checkinTime: startedAt, location: response.location || null }),
          );
        } else {
          const checkedOutAt = await persistCheckoutTime(Date.now());
          dispatch(setCheckout({ checkoutTime: checkedOutAt }));
        }
        console.log(`${LOG_PREFIX} Auto ${type} succeeded`);
      } catch (error) {
        console.log(`${LOG_PREFIX} Auto ${type} failed:`, error?.message);
      }
    };

    // Listeners must be attached before startGeofence is even called: native
    // fires an immediate ENTER if the device is already inside the region at
    // registration time, and that event is live pub/sub, not a durable queue
    // — attaching afterwards risks silently missing that first check-in.
    const subscriptions = [
      addGeofenceEnterListener(() => performAttendanceAction("IN")),
      addGeofenceExitListener(() => performAttendanceAction("OUT")),
    ];

    const ensureMonitoring = async () => {
      try {
        if (isMonitoring()) return;

        const [foreground, background] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
        ]);
        if (foreground.status !== "granted" || background.status !== "granted") {
          console.log(`${LOG_PREFIX} Location permission not granted yet, skipping`);
          return;
        }

        const nearest = await getOfficeLocation(employeeCode);
        if (cancelled || !nearest) return;

        await startGeofence({
          identifier: OFFICE_GEOFENCE_IDENTIFIER,
          latitude: nearest.latitude,
          longitude: nearest.longitude,
          radius: nearest.radius > 0 ? nearest.radius : 100,
        });
        console.log(`${LOG_PREFIX} Monitoring (re)established`, nearest);
      } catch (error) {
        console.log(`${LOG_PREFIX} Failed to (re)start monitoring:`, error?.message);
      }
    };
    ensureMonitoring();

    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [isLoggedIn, mode, employeeCode, dispatch]);

  return null;
}

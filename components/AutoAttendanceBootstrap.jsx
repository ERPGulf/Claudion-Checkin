import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import {
  normalizeGeotagging,
  selectAutoAttendanceActive,
  selectAutoAttendanceFullActions,
  setAutoAttendanceGeotagging,
} from "../redux/Slices/AutoAttendanceSlice";
import { setCheckin, setCheckout } from "../redux/Slices/AttendanceSlice";
import {
  persistCheckinStartTime,
  persistCheckoutTime,
} from "../utils/attendanceSession";
import { autoCheckInOut, getOfficeLocation } from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { presentLocalNotification } from "../services/notifications/localNotifications";
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
 * Automatic attendance is governed by the server-side `geotagging` policy on
 * the employee record, not by a local user choice — so this component is also
 * the single place that syncs that policy into Redux on login. Its jobs:
 *  - fetch the employee's `geotagging` value on login and mirror it into Redux
 *    (falling back to the last cached value if the network call fails),
 *  - re-attach the geofence ENTER/EXIT listeners on every app launch/login,
 *    since those are JS-side and don't survive a JS engine restart even
 *    though the native geofence registration itself does, and
 *  - perform the real check-in/checkout API call when the policy is
 *    "all attendance actions" (geotagging === 2), so it fires from anywhere in
 *    the app, not just while the AutoAttendance screen happens to be mounted.
 *
 * Registration is only (re-)established here if location permission is
 * already granted — this component runs on login, with no user gesture, so
 * it must never trigger a permission prompt itself (that only happens when
 * the user explicitly enables it on the AutoAttendance screen).
 */
export default function AutoAttendanceBootstrap() {
  const dispatch = useDispatch();
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const active = useSelector(selectAutoAttendanceActive);
  const fullActions = useSelector(selectAutoAttendanceFullActions);
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode,
  );

  // Read inside the listener closures without re-subscribing on every change.
  const fullActionsRef = useRef(fullActions);
  fullActionsRef.current = fullActions;
  const employeeCodeRef = useRef(employeeCode);
  employeeCodeRef.current = employeeCode;
  // The office geofence's reporting location, captured when monitoring is
  // (re)established, so auto check-in/out can tag its log without a GPS fetch.
  const officeRef = useRef(null);

  // Sync the server-side geotagging policy into Redux whenever we log in or the
  // employee changes. Uses the lightweight employee-data GET (no GPS); on
  // failure, falls back to whatever getOfficeLocation last cached so an offline
  // launch still respects the last known policy.
  useEffect(() => {
    if (!isLoggedIn || !employeeCode) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const employee = await fetchEmployeeData(employeeCode);
        if (cancelled) return;
        dispatch(setAutoAttendanceGeotagging(employee?.geotagging));
        console.log(`${LOG_PREFIX} Geotagging policy synced`, employee?.geotagging);
      } catch (error) {
        console.log(`${LOG_PREFIX} Failed to fetch geotagging policy:`, error?.message);
        try {
          const cached = await AsyncStorage.getItem("geotagging");
          if (!cancelled && cached != null) {
            dispatch(setAutoAttendanceGeotagging(normalizeGeotagging(cached)));
          }
        } catch (cacheError) {
          console.log(`${LOG_PREFIX} Failed to read cached geotagging:`, cacheError?.message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, employeeCode, dispatch]);

  useEffect(() => {
    if (!isAvailable()) return undefined;

    if (!isLoggedIn || !active) {
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
        const response = await autoCheckInOut({
          employeeCode: code,
          type,
          office: officeRef.current,
        });
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
          const officeName = officeRef.current?.locationName;
          presentLocalNotification({
            title: "Checked out",
            body: officeName
              ? `You left ${officeName}, so you've been checked out automatically.`
              : "You left the office, so you've been checked out automatically.",
            data: { type: "auto-checkout" },
          });
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

        officeRef.current = nearest;

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
  }, [isLoggedIn, active, employeeCode, dispatch]);

  return null;
}

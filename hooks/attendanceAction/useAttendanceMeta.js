import { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setCheckin,
  resetCheckin,
  setBreakMinutes,
  setTodayHours,
  setMonthlyHours,
  selectCheckinTime,
} from "../../redux/Slices/AttendanceSlice";
import { updateDateTime } from "../../utils/TimeServices";
import {
  getOfficeLocation,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  getServerTime,
  getTodayBreaks,
} from "../../services/api/attendance.service";
import { getTodayString } from "./helpers";

const CHECKIN_START_STORAGE_KEY = "checkinStartTime";
const CHECKOUT_TIME_STORAGE_KEY = "lastCheckoutTime";

const parseTimestampToMs = (value) => {
  if (value === null || value === undefined || value === "") return null;

  const normalizeEpochMs = (epoch) =>
    epoch < 1_000_000_000_000 ? epoch * 1000 : epoch;

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      return Number.isFinite(asNumber) ? normalizeEpochMs(asNumber) : null;
    }
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const pickBestCheckinStartMs = (...candidates) => {
  const now = Date.now();
  const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

  const normalized = candidates.filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (normalized.length === 0) return now;

  const plausible = normalized.filter(
    (value) => value <= now + MAX_FUTURE_SKEW_MS,
  );

  const pool = plausible.length ? plausible : normalized;
  return Math.max(...pool);
};

const dropIfNotAfterCheckout = (candidate, lastCheckoutMs) => {
  if (!Number.isFinite(candidate)) return null;
  if (!Number.isFinite(lastCheckoutMs)) return candidate;
  return candidate > lastCheckoutMs ? candidate : null;
};

function useAttendanceMeta({ employeeCode, isMountedRef }) {
  const dispatch = useDispatch();
  const existingCheckinTime = useSelector(selectCheckinTime);

  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(true);
  const [ready, setReady] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [restrictLocation, setRestrictLocation] = useState("0");
  const [restrictionLoaded, setRestrictionLoaded] = useState(false);

  const isLocationBlocked = restrictLocation === "1" && !inTarget;

  const locationStatusText = useMemo(() => {
    if (restrictLocation === "0") return "Not Required";
    if (!ready) return "Getting Location...";
    return inTarget ? "In bound" : "Out of bound";
  }, [restrictLocation, ready, inTarget]);

  useEffect(() => {
    const loadRestriction = async () => {
      const stored = await AsyncStorage.getItem("restrict_location");
      if (!isMountedRef.current) return;
      setRestrictLocation(stored === "1" ? "1" : "0");
      setRestrictionLoaded(true);
    };

    loadRestriction();
  }, [isMountedRef]);

  const syncCheckinFromStatus = useCallback(
    async (status) => {
      const isCheckedIn =
        status?.custom_in === 1 ||
        status?.custom_in === "1" ||
        status?.custom_in === true ||
        `${status?.log_type || ""}`.toUpperCase() === "IN";

      if (isCheckedIn) {
        const statusStartMs = parseTimestampToMs(
          status?.checkin_time ??
            status?.timestamp ??
            status?.creation ??
            status?.time ??
            status?.checkinTime,
        );
        const storedStartRaw = await AsyncStorage.getItem(
          CHECKIN_START_STORAGE_KEY,
        );
        const lastCheckoutRaw = await AsyncStorage.getItem(
          CHECKOUT_TIME_STORAGE_KEY,
        );

        const storedStartMs = parseTimestampToMs(storedStartRaw);
        const existingStartMs = parseTimestampToMs(existingCheckinTime);
        const lastCheckoutMs = parseTimestampToMs(lastCheckoutRaw);

        const sanitizedStatusStartMs = dropIfNotAfterCheckout(
          statusStartMs,
          lastCheckoutMs,
        );
        const sanitizedStoredStartMs = dropIfNotAfterCheckout(
          storedStartMs,
          lastCheckoutMs,
        );
        const sanitizedExistingStartMs = dropIfNotAfterCheckout(
          existingStartMs,
          lastCheckoutMs,
        );

        const checkinStartTime = pickBestCheckinStartMs(
          sanitizedStatusStartMs,
          sanitizedStoredStartMs,
          sanitizedExistingStartMs,
        );

        await AsyncStorage.setItem(
          CHECKIN_START_STORAGE_KEY,
          String(checkinStartTime),
        );

        if (
          Number.isFinite(lastCheckoutMs) &&
          Number.isFinite(checkinStartTime) &&
          checkinStartTime > lastCheckoutMs
        ) {
          await AsyncStorage.removeItem(CHECKOUT_TIME_STORAGE_KEY);
        }

        dispatch(
          setCheckin({
            checkinTime: checkinStartTime,
            location: null,
          }),
        );
        return;
      }

      await AsyncStorage.removeItem(CHECKIN_START_STORAGE_KEY);
      dispatch(resetCheckin());
    },
    [dispatch, existingCheckinTime],
  );

  useEffect(() => {
    const loadCheckinStatus = async () => {
      try {
        const status = await getAttendanceStatus();

        if (!isMountedRef.current) return;
        await syncCheckinFromStatus(status);
      } catch (error) {
        console.log("Status sync error:", error);
      }
    };

    if (employeeCode) {
      loadCheckinStatus();
    }
  }, [employeeCode, isMountedRef, syncCheckinFromStatus]);

  const fetchStatusAndLocation = useCallback(async () => {
    setReady(false);

    try {
      if (restrictLocation === "0") {
        setInTarget(true);
        setDistanceInfo(null);
        return;
      }

      const nearest = await getOfficeLocation(employeeCode);
      if (!isMountedRef.current) return;
      setInTarget(nearest.withinRadius);
      setDistanceInfo(nearest);
    } catch (error) {
      if (!isMountedRef.current) return;
      Toast.show({
        type: "error",
        text1: ":warning: Location error",
        text2: error.message,
      });
      setInTarget(false);
    } finally {
      if (!isMountedRef.current) return;
      setReady(true);
    }
  }, [employeeCode, isMountedRef, restrictLocation]);

  const onRefresh = useCallback(() => {
    setRefresh(true);
    fetchStatusAndLocation().finally(() => {
      if (!isMountedRef.current) return;
      setRefresh(false);
    });
  }, [fetchStatusAndLocation, isMountedRef]);

  useEffect(() => {
    if (restrictionLoaded && employeeCode) {
      fetchStatusAndLocation();
    }
  }, [employeeCode, fetchStatusAndLocation, restrictionLoaded]);

  useEffect(() => {
    const loadServerTime = async () => {
      const server = await getServerTime();
      if (!isMountedRef.current) return;
      if (server) setDateTime(updateDateTime(server));
    };

    loadServerTime();
    const intervalId = setInterval(loadServerTime, 10000);

    return () => clearInterval(intervalId);
  }, [isMountedRef]);

  const refreshAttendanceData = useCallback(async () => {
    const todayStr = getTodayString();
    const now = new Date();

    const [todayWorked, monthlyWorked, breakData] = await Promise.all([
      getDailyWorkedHours(employeeCode, todayStr),
      getMonthlyWorkedHours(
        employeeCode,
        now.getMonth() + 1,
        now.getFullYear(),
      ),
      getTodayBreaks(employeeCode, todayStr),
    ]);

    dispatch(setTodayHours(todayWorked ?? "00:00"));
    dispatch(setMonthlyHours(monthlyWorked ?? "00:00"));
    dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

    return breakData;
  }, [dispatch, employeeCode]);

  return {
    dateTime,
    distanceInfo,
    fetchStatusAndLocation,
    inTarget,
    isLocationBlocked,
    locationStatusText,
    onRefresh,
    ready,
    refresh,
    refreshAttendanceData,
    restrictLocation,
    restrictionLoaded,
    syncCheckinFromStatus,
  };
}

export default useAttendanceMeta;

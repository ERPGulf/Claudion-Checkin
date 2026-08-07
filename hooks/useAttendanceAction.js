import { useEffect, useState, useRef, useCallback } from "react";
import { Alert } from "react-native";
import { useDispatch, useSelector } from "react-redux";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setCheckin,
  setCheckout,
  resetCheckin,
  setBreakMinutes,
  setBreakStatus,
  setTodayHours,
  setMonthlyHours,
} from "../redux/Slices/AttendanceSlice";

import { updateDateTime } from "../utils/TimeServices";
import { saveTokens } from "../services/api/apiClient";
import {
  userCheckIn,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  getServerTime,
  employeeBreak,
  getTodayBreaks,
} from "../services/api/attendance.service";
import {
  getPersistedSessionTimes,
  resolveActiveSessionStart,
} from "../utils/attendanceSession";
import {
  performSessionTransition,
  readSession,
  reconcileSessionFromServer,
  SESSION_ORIGIN,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";
import {
  selectAutoAttendanceActive,
  selectAutoAttendanceFullActions,
} from "../redux/Slices/AutoAttendanceSlice";
import {
  getQueueCounts,
  submitManualAttendance,
} from "../services/offline/AttendanceQueueService";
import { resolveNearestOffice } from "../services/offline/offlineAttendanceGate";
import { formatOfflineTimestamp } from "../utils/serverClock";

/**
 * All Attendance Action behaviour: session/break state, the location gate, the
 * status polling and every handler.
 *
 * Extracted verbatim from the original screen so the classic and modern screens
 * are pure presentation over one shared implementation — there is no second copy
 * of the attendance rules to keep in step. Header setup deliberately stays in
 * the screens, since that is the one thing the two do differently.
 */
const BREAK_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Returns today's date formatted as DD-MM-YYYY */
const getTodayString = () =>
  new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

export default function useAttendanceAction() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const checkin = useSelector((state) => state.attendance.checkin);
  const checkinTime = useSelector((state) => state.attendance.checkinTime);
  const checkinLocation = useSelector((state) => state.attendance.location);
  const userDetails = useSelector((state) => state.user.userDetails);
  const breakMinutes = useSelector((state) => state.attendance.breakMinutes);
  const sessionOrigin = useSelector((state) => state.attendance.sessionOrigin);
  // Monitoring has to be running (policy allows it AND the user opted in) and
  // the policy has to cover attendance actions before the geofence will close
  // this session — otherwise promising an automatic check-out would be a lie.
  const autoMonitoringActive = useSelector(selectAutoAttendanceActive);
  const autoActionsEnabled =
    useSelector(selectAutoAttendanceFullActions) && autoMonitoringActive;
  const employeeCode = userDetails?.employeeCode;
  const [refresh, setRefresh] = useState(false);
  const [dateTime, setDateTime] = useState(null);
  const [inTarget, setInTarget] = useState(true);
  const [ready, setReady] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [restrictLocation, setRestrictLocation] = useState(0);
  const [unrestrictedCheckout, setUnrestrictedCheckout] = useState(0);
  const [restrictionLoaded, setRestrictionLoaded] = useState(false);
  const [onBreak, setOnBreak] = useState(false);
  const [liveBreakTime, setLiveBreakTime] = useState("00:00:00");
  const [breakStartTime, setBreakStartTime] = useState(null);
  const breakTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const [breakCompleted, setBreakCompleted] = useState(false);
  const [monthlyCapMessage, setMonthlyCapMessage] = useState("");
  const [devBreakMockMode, setDevBreakMockMode] = useState(false);
  const isBreakCompleted = (breakData) => {
    if (!breakData?.breaks?.length) return false;

    const hasIn = breakData.breaks.some((b) => b.start);
    const hasOut = breakData.breaks.some((b) => b.end);

    return hasIn && hasOut;
  };
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load location restriction
  useEffect(() => {
    const loadRestriction = async () => {
      const r = await AsyncStorage.getItem("restrict_location");
      const u = await AsyncStorage.getItem("unrestricted_checkout_location");
      if (!isMountedRef.current) return;
      setRestrictLocation(Number(r) || 0);

      setUnrestrictedCheckout(Number(u) || 0);
      setRestrictionLoaded(true);
    };
    loadRestriction();
  }, []);

  /** Mirrors a session record from the state machine into Redux. */
  const syncUiToSession = useCallback(
    (session) => {
      if (session?.status === SESSION_STATUS.CHECKED_IN) {
        dispatch(
          setCheckin({
            checkinTime: session.startedAt,
            location: checkinLocation,
            sessionOrigin: session.origin,
          }),
        );
        return;
      }

      dispatch(setCheckout({ checkoutTime: session?.endedAt ?? Date.now() }));
    },
    [checkinLocation, dispatch],
  );

  /**
   * Paints the UI from the durable local record — the device's own answer to
   * "am I checked in?", which does not depend on a request succeeding.
   *
   * Only ever opens the session in Redux, never closes it: the callers below use
   * this when the server's answer is not admissible evidence, and in that
   * situation the absence of a session is not a fact either.
   */
  const mirrorLocalSession = useCallback(async () => {
    const session = await readSession();

    if (session.status === SESSION_STATUS.CHECKED_IN) {
      dispatch(
        setCheckin({
          checkinTime: session.startedAt,
          location: checkinLocation,
          sessionOrigin: session.origin,
        }),
      );
    }

    return session;
  }, [checkinLocation, dispatch]);

  const syncCheckinFromStatus = useCallback(
    async (status, fetchedAt) => {
      // The status request never reached the server, so it says nothing about
      // the session and must not be used to close one. Without this an offline
      // check-in was reverted the moment this screen refocused: the UI went back
      // to "Check in", the durable record went CHECKED_OUT, a second tap queued a
      // duplicate punch, and a later geofence EXIT found no session to close.
      if (status?.unavailable) {
        await mirrorLocalSession();
        return;
      }

      const { checkinStartTime, lastCheckoutTime } =
        await getPersistedSessionTimes();

      const resolvedStart = resolveActiveSessionStart({
        status,
        storedCheckinStartTime: checkinStartTime,
        reduxCheckinTime: checkinTime,
        lastCheckoutTime,
      });

      // The server answered, and it said there is no open session — but it
      // cannot have seen punches still sitting in the outbox, so that answer is
      // not evidence about them. This is the reconnect race, and it is nastier
      // than the offline case because everything looks healthy: the network is
      // back, the request succeeds, and it legitimately returns "checked out"
      // simply because the drain has not uploaded the check-in yet. Reconciling
      // on it closes the session, the button flips back to "Check in", and the
      // next tap files a duplicate at a fresh timestamp — a different dedupe key,
      // so the UNIQUE index does not catch it either.
      //
      // Only the closing direction needs this. A queued check-OUT cannot be
      // undone by a stale "still checked in", because `reconcileSessionFromServer`
      // already rejects a start that predates `lastCheckoutTime`.
      if (!resolvedStart) {
        // Fail open. A queue read that throws must not abort the whole status
        // sync — reconciling is the pre-existing behaviour and the safer default
        // when the outbox cannot be inspected, since a database that cannot be
        // read is also one nothing could have been queued into.
        const unsynced = await getQueueCounts(employeeCode)
          .then((counts) => counts?.unsynced ?? 0)
          .catch((error) => {
            console.log("Queue count failed, reconciling anyway:", error?.message);
            return 0;
          });

        if (unsynced > 0) {
          const session = await mirrorLocalSession();
          if (session.status === SESSION_STATUS.CHECKED_IN) return;
        }
      }

      // Push the server's verdict into the session state machine before
      // mirroring it into Redux, so the geofence listeners — which read the
      // machine, not Redux — agree with what this screen is showing.
      //
      // `fetchedAt` is when the status request went out: it stops this stale
      // snapshot from closing a session that the geofence opened while the
      // request was still in flight.
      const session = await reconcileSessionFromServer({
        activeStartedAt: resolvedStart,
        fetchedAt,
      });

      if (session.status === SESSION_STATUS.CHECKED_IN) {
        dispatch(
          setCheckin({
            checkinTime: session.startedAt,
            location: checkinLocation,
            sessionOrigin: session.origin,
          }),
        );
        return;
      }

      dispatch(resetCheckin());
    },
    [checkinLocation, checkinTime, dispatch, employeeCode, mirrorLocalSession],
  );

  useEffect(() => {
    const loadCheckinStatus = async () => {
      try {
        // Captured before the request so a session opened while it is in flight
        // is recognised as newer than the response.
        const fetchedAt = Date.now();
        const res = await getAttendanceStatus();

        if (!isMountedRef.current) return;

        await syncCheckinFromStatus(res, fetchedAt);
      } catch (e) {
        console.log("Status sync error:", e);
      }
    };

    if (employeeCode) {
      loadCheckinStatus();
    }
  }, [employeeCode, syncCheckinFromStatus]);

  const fetchStatusAndLocation = useCallback(async () => {
    try {
      setReady(false);

      // if (restrictLocation === 0) {
      //   setInTarget(true);
      //   setDistanceInfo(null);
      //   setReady(true);
      //   return;
      // }

      // Resolved from the cached configuration when there is no connection.
      // This used to be `getOfficeLocation`, a network call, whose failure left
      // `inTarget` false — which disables the check-in button under
      // `restrict_location`, putting offline attendance out of reach on exactly
      // the tenants that need it. A permission denial still throws.
      const nearest = await resolveNearestOffice(employeeCode);
      if (!isMountedRef.current) return;
      if (!nearest) {
        setInTarget(false);
        setDistanceInfo(null);
        setReady(true);
        return;
      }

      setInTarget(nearest.withinRadius);
      setDistanceInfo(nearest);
      setReady(true);
    } catch (error) {
      if (!isMountedRef.current) return;
      Toast.show({
        type: "error",
        text1: "Location error",
        text2: error.message,
      });
      setInTarget(false);
      setReady(true);
    }
  }, [restrictLocation, employeeCode]);

  // Fetch GPS on mount
  useEffect(() => {
    if (restrictionLoaded && employeeCode) fetchStatusAndLocation();
  }, [restrictionLoaded, employeeCode, fetchStatusAndLocation]);

  // Update date & time every 10 seconds
  useEffect(() => {
    const loadServerTime = async () => {
      // `getServerTime` was previously called bare: offline it rejects, the
      // rejection escapes the interval callback unhandled, and the row renders
      // blank forever. A clock is the one thing on this screen the device can
      // always answer, so it falls back to the device clock corrected by the
      // last measured server offset — the same value a queued punch is stamped
      // with, so the row and the record agree.
      try {
        const server = await getServerTime();
        if (!isMountedRef.current) return;
        if (server) {
          setDateTime(updateDateTime(server));
          return;
        }
      } catch {
        // Fall through to the local clock.
      }

      const local = await formatOfflineTimestamp();
      if (!isMountedRef.current) return;
      setDateTime(updateDateTime(local));
    };

    loadServerTime();
    const intervalId = setInterval(loadServerTime, 10000);
    return () => clearInterval(intervalId);
  }, []);

  /**
   * Dispatches today + monthly worked hours and break minutes to Redux.
   * Avoids duplicating three identical Promise.all blocks across handlers.
   */
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

  /**
   * Syncs onBreak / breakStartTime state from a breakData response object.
   */

  const syncBreakState = useCallback(async (breakData) => {
    const lastBreak = breakData?.breaks?.find((b) => !b.end || b.end === null);

    if (!lastBreak) {
      setOnBreak(false);
      setBreakStartTime(null);
      await AsyncStorage.removeItem("breakStartTime"); // ✅ keep storage clean
      return;
    }

    const isOpen =
      !lastBreak.end || lastBreak.end === "" || lastBreak.end === null;

    setOnBreak(isOpen);

    if (isOpen) breakTriggeredRef.current = false;

    const savedTime = await AsyncStorage.getItem("breakStartTime");

    if (savedTime) {
      setBreakStartTime(parseInt(savedTime));
    } else {
      const backendTime = new Date(lastBreak.start).getTime();
      setBreakStartTime(backendTime);

      await AsyncStorage.setItem("breakStartTime", backendTime.toString());
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      try {
        if (!employeeCode) return;

        // ✅ 1. FIRST: sync attendance status
        const fetchedAt = Date.now();
        const res = await getAttendanceStatus();

        console.log("FOCUS STATUS:", res.custom_in);

        if (!isMountedRef.current) return;

        await syncCheckinFromStatus(res, fetchedAt);

        // ✅ 2. THEN: fetch totals
        const breakData = await refreshAttendanceData();

        if (!isMountedRef.current) return;
        setBreakCompleted(isBreakCompleted(breakData));

        syncBreakState(breakData);
      } catch (e) {
        console.log("Focus sync error:", e);
      }
    });

    return unsubscribe;
  }, [
    navigation,
    employeeCode,
    refreshAttendanceData,
    syncBreakState,
    syncCheckinFromStatus,
  ]);

  useEffect(() => {
    const loadBreak = async () => {
      const saved = await AsyncStorage.getItem("breakStartTime");
      const breakData = await getTodayBreaks(employeeCode, getTodayString());
      setBreakCompleted(isBreakCompleted(breakData));

      if (saved) {
        const parsedTime = parseInt(saved);

        setBreakStartTime(parsedTime);
        setOnBreak(true);
      }
    };

    loadBreak();
  }, []);

  useEffect(() => {
    if (!onBreak || !breakStartTime) {
      setLiveBreakTime("00:00:00");
      return;
    }

    const interval = setInterval(async () => {
      const diff = Date.now() - breakStartTime;
      const currentBreakSeconds = Math.floor(diff / 1000);

      const hrs = String(Math.floor(currentBreakSeconds / 3600)).padStart(
        2,
        "0",
      );
      const mins = String(
        Math.floor((currentBreakSeconds % 3600) / 60),
      ).padStart(2, "0");
      const secs = String(currentBreakSeconds % 60).padStart(2, "0");
      setLiveBreakTime(`${hrs}:${mins}:${secs}`);

      if (diff >= BREAK_LIMIT_MS && !breakTriggeredRef.current) {
        breakTriggeredRef.current = true;

        try {
          await employeeBreak({ employeeCode, type: "OUT" });
          await AsyncStorage.removeItem("breakStartTime");

          if (!isMountedRef.current) return;
          setOnBreak(false);
          setBreakStartTime(null);
          setBreakCompleted(true);

          const breakData = await getTodayBreaks(
            employeeCode,
            getTodayString(),
          );
          if (!isMountedRef.current) return;
          dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

          Alert.alert(
            "Break Ended",
            "2-hour break limit reached. Break automatically stopped.",
          );
        } catch {
          Alert.alert("Error", "Auto break end failed");
        }
      }
    }, 1000);
    console.log("BREAK START TIME:", breakStartTime);
    console.log("NOW:", Date.now());
    console.log("DIFF MIN:", (Date.now() - breakStartTime) / 60000);

    return () => clearInterval(interval);
  }, [onBreak, breakStartTime, dispatch, employeeCode]);

  const handleDirectCheckInOut = useCallback(
    async (type) => {
      try {
        setActionLoading(true);

        // `submitManualAttendance` runs `userCheckIn` unchanged when there is a
        // connection, and queues the punch locally when there is not. Either way
        // it returns the same `{ allowed }` contract, so the session state
        // machine treats an offline check-in as an ordinary open session — which
        // is what lets a geofence EXIT still close it hours later.
        const outcome = await performSessionTransition({
          type,
          origin: SESSION_ORIGIN.MANUAL,
          execute: () =>
            submitManualAttendance({
              type,
              employeeCode,
              online: () =>
                userCheckIn({
                  employeeCode,
                  type,
                  locationData: distanceInfo,
                }),
            }),
        });

        // The session already moved without this screen knowing — almost
        // always the geofence checked the user out in the background. Nothing
        // was sent; just re-sync the UI to the real state.
        if (outcome.status === TRANSITION_RESULT.SKIPPED) {
          syncUiToSession(outcome.session);

          Toast.show({
            type: "info",
            text1:
              outcome.session.status === SESSION_STATUS.CHECKED_IN
                ? "Already checked in"
                : "Already checked out",
            text2:
              outcome.session.closedBy === SESSION_ORIGIN.AUTO
                ? "You were checked out automatically when you left the office."
                : undefined,
          });
          return;
        }

        if (outcome.status === TRANSITION_RESULT.FAILED) {
          Toast.show({
            type: "error",
            text1: "Action blocked",
            text2: outcome.response?.message,
          });
          return;
        }

        const { session, response } = outcome;

        if (type === "IN") {
          dispatch({ type: "attendance/setSelectedLocation", payload: null });
          dispatch(
            setCheckin({
              checkinTime: session.startedAt,
              location: restrictLocation === 1 ? response.location : null,
              sessionOrigin: session.origin,
            }),
          );
        } else {
          if (onBreak) {
            const breakRes = await employeeBreak({
              employeeCode,
              type: "OUT",
            });
            if (!breakRes?.allowed) {
              console.log("Break already ended from backend");
            }
          }

          dispatch(setCheckout({ checkoutTime: session.endedAt }));
          dispatch({ type: "attendance/setSelectedLocation", payload: null });
        }

        const breakData = await refreshAttendanceData();
        syncBreakState(breakData);

        // A queued punch is a success, not a warning — the employee's day is
        // recorded and nothing more is required of them. It is labelled as
        // offline only so the absence of it in the web desk for a while is not a
        // surprise.
        if (response?.queued) {
          Toast.show({
            type: "success",
            text1: type === "IN" ? "Checked in offline" : "Checked out offline",
            text2: "Saved on your device — it'll sync when you're back online.",
          });
          return;
        }

        Toast.show({
          type: "success",
          text1: type === "IN" ? "Checked in!" : "Checked out!",
        });
      } catch (error) {
        console.log("AttendanceAction.handleDirectCheckInOut error:", {
          errorMessage: error?.message,
          status: error?.response?.status,
          responseData: error?.response?.data,
        });

        Toast.show({
          type: "error",
          text1: "Failed",
          text2:
            error?.response?.data?.message ||
            error?.response?.data ||
            error.message ||
            "Request failed",
        });
      } finally {
        setActionLoading(false);
      }
    },
    [
      employeeCode,
      distanceInfo,
      restrictLocation,
      onBreak,
      dispatch,
      refreshAttendanceData,
      syncBreakState,
      syncUiToSession,
    ],
  );

  const handleInvalidateAccessToken = useCallback(async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("refresh_token");

      if (!refreshToken) {
        Toast.show({
          type: "error",
          text1: "Refresh token missing",
          text2: "Cannot invalidate access token without a refresh token.",
        });
        return;
      }

      await saveTokens("invalid-access-token-123", refreshToken);
      const maskedRefresh = `${refreshToken.slice(0, 6)}...${refreshToken.slice(-4)}`;
      Toast.show({
        type: "success",
        text1: "Dev token invalidated",
        text2: `Refresh token preserved: ${maskedRefresh}`,
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Dev token reset failed",
        text2: error.message || "Unable to invalidate access token.",
      });
    }
  }, []);

  const applyDevBreakPreset = useCallback(
    async (preset) => {
      const now = Date.now();
      const setIdleState = async (minutes, completed = false) => {
        setOnBreak(false);
        setBreakStartTime(null);
        setBreakCompleted(completed);
        setMonthlyCapMessage("");
        breakTriggeredRef.current = false;
        dispatch(setBreakMinutes(minutes));
        dispatch(
          setBreakStatus({
            onBreak: false,
            breakStartTime: null,
          }),
        );
        await AsyncStorage.removeItem("breakStartTime");
      };

      dispatch(
        setCheckin({
          checkinTime: now,
          location: null,
        }),
      );

      if (preset === "idle-0") {
        await setIdleState(0, false);
      }

      if (preset === "idle-45") {
        await setIdleState(45, false);
      }

      if (preset === "running-30") {
        const startTime = now - 30 * 60 * 1000;
        setOnBreak(true);
        setBreakStartTime(startTime);
        setBreakCompleted(false);
        breakTriggeredRef.current = false;
        dispatch(setBreakMinutes(45));
        dispatch(
          setBreakStatus({
            onBreak: true,
            breakStartTime: startTime,
          }),
        );
        await AsyncStorage.setItem("breakStartTime", String(startTime));
      }

      if (preset === "cap-120") {
        await setIdleState(120, false);
      }

      if (preset === "completed") {
        await setIdleState(60, true);
      }

      if (preset === "monthly-cap") {
        await setIdleState(30, true);
        setMonthlyCapMessage("Monthly break limit reached (8h)");
        Toast.show({
          type: "error",
          text1: "Monthly break limit reached (8h)",
        });
      }

      if (__DEV__) {
        setDevBreakMockMode(true);
      }

      Toast.show({
        type: "success",
        text1: `DEV preset applied: ${preset}`,
      });
    },
    [dispatch],
  );

  const handleBreak = useCallback(async () => {
    if (!checkin) {
      Toast.show({ type: "error", text1: "Please check-in first" });
      return;
    }

    if (restrictLocation === 1 && !inTarget) {
      Toast.show({
        type: "error",
        text1: "You are out of allowed location",
      });
      return;
    }

    if (__DEV__ && devBreakMockMode) {
      try {
        setActionLoading(true);

        if (!onBreak) {
          const startTime = Date.now();
          setOnBreak(true);
          setBreakStartTime(startTime);
          setBreakCompleted(false);
          setMonthlyCapMessage("");
          breakTriggeredRef.current = false;

          dispatch(
            setBreakStatus({
              onBreak: true,
              breakStartTime: startTime,
            }),
          );
          await AsyncStorage.setItem("breakStartTime", String(startTime));

          Toast.show({ type: "success", text1: "DEV break started (local)" });
          return;
        }

        const elapsedMinutes = Math.max(
          0,
          Math.floor((Date.now() - breakStartTime) / 60000),
        );
        const nextTotal = Math.min(120, (breakMinutes ?? 0) + elapsedMinutes);

        setOnBreak(false);
        setBreakStartTime(null);
        setBreakCompleted(true);
        setMonthlyCapMessage("");
        dispatch(setBreakMinutes(nextTotal));
        dispatch(
          setBreakStatus({
            onBreak: false,
            breakStartTime: null,
          }),
        );
        await AsyncStorage.removeItem("breakStartTime");

        Toast.show({
          type: "success",
          text1: `DEV break ended (total: ${nextTotal}m)`,
        });
        return;
      } finally {
        setActionLoading(false);
      }
    }

    // ✅ FIRST check from backend (important)
    const breakDataCheck = await getTodayBreaks(employeeCode, getTodayString());

    if (isBreakCompleted(breakDataCheck)) {
      Toast.show({
        type: "error",
        text1: "Break already completed for today",
      });
      return;
    }

    const type = onBreak ? "OUT" : "IN";

    try {
      setActionLoading(true);
      const response = await employeeBreak({ employeeCode, type });

      if (!response.allowed) {
        // ✅ Handle monthly limit from backend
        if (response.message?.includes("Monthly break limit")) {
          setBreakCompleted(true); // disable button
          setMonthlyCapMessage(response.message);
        } else {
          setMonthlyCapMessage("");
        }

        Toast.show({ type: "error", text1: response.message });
        return;
      }

      if (type === "IN") {
        const startTime = Date.now();

        setOnBreak(true);
        setBreakStartTime(startTime);
        setMonthlyCapMessage("");

        await AsyncStorage.setItem("breakStartTime", startTime.toString());
      } else {
        setOnBreak(false);
        setBreakStartTime(null);
        setMonthlyCapMessage("");

        await AsyncStorage.removeItem("breakStartTime");
      }

      // ✅ Fetch latest break data
      const breakData = await getTodayBreaks(employeeCode, getTodayString());

      setBreakCompleted(isBreakCompleted(breakData));
      dispatch(setBreakMinutes(breakData?.total_break_minutes ?? 0));

      syncBreakState(breakData);

      Toast.show({ type: "success", text1: response.message });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Break failed",
        text2: error.message,
      });
    } finally {
      setActionLoading(false);
    }
  }, [
    checkin,
    restrictLocation,
    inTarget,
    onBreak,
    devBreakMockMode,
    breakMinutes,
    breakStartTime,
    dispatch,
  ]);

  // The screens render their own "Loading settings..." state off
  // `restrictionLoaded`. It used to be an early `return` right here, which also
  // meant every hook below it had to stay above — a rules-of-hooks trap.
  const allowCheckoutAnywhere = checkin === true && unrestrictedCheckout === 1;


  /**
   * Check-in / check-out entry point. Photo mode ("photo" === "1") diverts to
   * the camera screen; otherwise the action posts directly. Lifted out of the
   * button's onPress so both the classic and modern screens call one path.
   */
  const handlePrimaryAction = useCallback(async () => {
    try {
      const photoValue = await AsyncStorage.getItem("photo");
      const actionType = checkin ? "OUT" : "IN";

      if (photoValue !== "1") {
        await handleDirectCheckInOut(actionType);
      } else {
        navigation.navigate("Attendance camera", {
          type: actionType,
        });
      }
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Action failed",
        text2: error.message,
      });
    }
  }, [checkin, handleDirectCheckInOut, navigation]);


  return {
    // session + status
    checkin,
    checkinTime,
    checkinLocation,
    sessionOrigin,
    autoActionsEnabled,
    dateTime,
    // location gating
    restrictLocation,
    unrestrictedCheckout,
    restrictionLoaded,
    allowCheckoutAnywhere,
    inTarget,
    ready,
    distanceInfo,
    // break state
    onBreak,
    liveBreakTime,
    breakMinutes,
    breakCompleted,
    monthlyCapMessage,
    // ui state
    actionLoading,
    refresh,
    setRefresh,
    // actions
    fetchStatusAndLocation,
    handlePrimaryAction,
    handleBreak,
    // dev-only helpers
    devBreakMockMode,
    setDevBreakMockMode,
    applyDevBreakPreset,
    handleInvalidateAccessToken,
  };
}

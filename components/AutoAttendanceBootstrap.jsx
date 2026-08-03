import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import {
  normalizeGeotagging,
  selectAutoAttendanceActive,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceSyncRequestId,
  setAutoAttendanceGeotagging,
} from "../redux/Slices/AutoAttendanceSlice";
import { setCheckin, setCheckout } from "../redux/Slices/AttendanceSlice";
import {
  isSessionActive,
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";
import {
  autoCheckInOut,
  getOfficeLocation,
} from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { presentLocalNotification } from "../services/notifications/localNotifications";
import {
  addGeofenceEnterListener,
  addGeofenceExitListener,
  getLastEvent,
  isAvailable,
  isMonitoring,
  OFFICE_GEOFENCE_IDENTIFIER,
  startGeofence,
  stopGeofence,
} from "../modules/expo-auto-attendance";
import {
  evaluatePendingEvent,
  getLastProcessedEventAt,
  markEventProcessed,
  PENDING_EVENT,
} from "../utils/geofenceEventLog";

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
 *    though the native geofence registration itself does,
 *  - replay a transition the OS delivered while JS was not running at all
 *    (see replayPendingEvent below), and
 *  - perform the real check-in/checkout API call when the policy is
 *    "all attendance actions" (geotagging === 2), so it fires from anywhere in
 *    the app, not just while the AutoAttendance screen happens to be mounted.
 *
 * Transitions go through the shared session state machine
 * (utils/attendanceSessionState.js), which is also what the manual screens
 * drive — that is what lets a geofence EXIT close a session the user started by
 * hand, and what stops it from ever duplicating a check-in or check-out.
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
  const syncRequestId = useSelector(selectAutoAttendanceSyncRequestId);
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
  // Serializes the startup sequence across effect runs — see the chain below.
  const startupRef = useRef(Promise.resolve());

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
        console.log(
          `${LOG_PREFIX} Geotagging policy synced`,
          employee?.geotagging,
        );
      } catch (error) {
        console.log(
          `${LOG_PREFIX} Failed to fetch geotagging policy:`,
          error?.message,
        );
        try {
          const cached = await AsyncStorage.getItem("geotagging");
          if (!cancelled && cached != null) {
            dispatch(setAutoAttendanceGeotagging(normalizeGeotagging(cached)));
          }
        } catch (cacheError) {
          console.log(
            `${LOG_PREFIX} Failed to read cached geotagging:`,
            cacheError?.message,
          );
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

    // A geofence transition is a request to move the attendance session state
    // machine, not an unconditional API call. The machine decides:
    //  - ENTER checks in only when no session is open, so walking back into the
    //    office after a manual check-in does not create a duplicate log,
    //  - EXIT checks out whichever session is open — manual or automatic — and
    //    does nothing when the user has already checked out by hand.
    //
    // `occurredAt` (device epoch ms) is when the transition actually happened.
    // It is the event's own timestamp for a live event and, for one replayed at
    // launch, the moment the OS recorded it while the app was killed — so both
    // the attendance log and the session record carry the real crossing time
    // rather than the time the app woke up.
    //
    // `markProcessed` advances the geofence replay high-water mark. It must stay
    // true for anything driven by a real native transition, and false for the
    // presence reconciliation below, which is not a transition at all: moving
    // the mark from it would swallow a native event recorded moments earlier
    // that has not been replayed yet.
    const performAttendanceAction = async (
      type,
      occurredAt,
      { markProcessed = true } = {},
    ) => {
      const recordHandled = async (at) => {
        if (markProcessed) await markEventProcessed(at);
      };

      // geotagging === 1 ("warnings only"): the crossing is detected and shown
      // on the AutoAttendance screen, but must never become an attendance log.
      // Mark it handled anyway — the policy in force AT THE CROSSING governs, so
      // raising the policy to 2 later must not retroactively replay it.
      if (!fullActionsRef.current) {
        console.log(
          `${LOG_PREFIX} Policy does not cover attendance actions; ignoring ${type}`,
        );
        await recordHandled(occurredAt);
        return;
      }

      // Transient, not a decision: retry on the next launch once it is known.
      const code = employeeCodeRef.current;
      if (!code) return;

      try {
        const outcome = await performSessionTransition({
          type,
          origin: SESSION_ORIGIN.AUTO,
          at: occurredAt,
          execute: () =>
            autoCheckInOut({
              employeeCode: code,
              type,
              office: officeRef.current,
              occurredAt,
            }),
        });

        // Handled either way: a skip means the session is already where this
        // event would have put it, so replaying it later can only misfire.
        if (
          outcome.status === TRANSITION_RESULT.COMPLETED ||
          outcome.status === TRANSITION_RESULT.SKIPPED
        ) {
          await recordHandled(occurredAt);
        }

        if (outcome.status === TRANSITION_RESULT.SKIPPED) {
          console.log(
            `${LOG_PREFIX} Auto ${type} skipped: session already ${outcome.session.status}`,
          );
          return;
        }

        if (outcome.status === TRANSITION_RESULT.FAILED) {
          console.log(
            `${LOG_PREFIX} Auto ${type} blocked:`,
            outcome.response?.message,
          );
          return;
        }

        const { session, previousSession, response } = outcome;

        if (type === "IN") {
          dispatch(
            setCheckin({
              checkinTime: session.startedAt,
              location: response.location || null,
              sessionOrigin: session.origin,
            }),
          );
        } else {
          dispatch(setCheckout({ checkoutTime: session.endedAt }));
          const officeName = officeRef.current?.locationName;
          const startedManually =
            previousSession.origin === SESSION_ORIGIN.MANUAL;
          presentLocalNotification({
            title: "Checked out",
            body: officeName
              ? `You left ${officeName}, so ${startedManually ? "your check-in was closed" : "you've been checked out"} automatically.`
              : `You left the office, so ${startedManually ? "your check-in was closed" : "you've been checked out"} automatically.`,
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
      addGeofenceEnterListener((event) =>
        performAttendanceAction("IN", event?.timestamp),
      ),
      addGeofenceExitListener((event) =>
        performAttendanceAction("OUT", event?.timestamp),
      ),
    ];

    /**
     * Applies a transition the OS delivered to native code while JS was not
     * running (app killed, or launched by the OS for the event itself). Native
     * persists the last transition but cannot call the attendance API, so
     * without this a check-out could be lost until the user next pressed a
     * button. Safe to run on every launch: the high-water mark skips events
     * already handled, and the session state machine skips ones that would not
     * change anything.
     */
    const replayPendingEvent = async () => {
      try {
        let lastEvent = null;
        try {
          lastEvent = getLastEvent();
        } catch {
          return; // No native record available on this build.
        }

        const pending = evaluatePendingEvent({
          lastEvent,
          lastProcessedAt: await getLastProcessedEventAt(),
        });

        if (cancelled || pending.status === PENDING_EVENT.NONE) return;

        if (pending.status === PENDING_EVENT.EXPIRED) {
          console.log(
            `${LOG_PREFIX} Discarding stale ${lastEvent?.transition} from`,
            new Date(pending.occurredAt).toISOString(),
          );
          await markEventProcessed(pending.occurredAt);
          return;
        }

        // A crossing that predates the open session cannot be about it —
        // replaying it would stamp a check-out before its own check-in. Happens
        // when a manual check-in wins the race against this replay at launch.
        if (pending.type === "OUT") {
          const session = await readSession();
          if (
            isSessionActive(session) &&
            session.startedAt &&
            pending.occurredAt < session.startedAt
          ) {
            console.log(
              `${LOG_PREFIX} Discarding EXIT that predates the open session`,
            );
            await markEventProcessed(pending.occurredAt);
            return;
          }
        }

        console.log(
          `${LOG_PREFIX} Replaying missed ${lastEvent?.transition} from`,
          new Date(pending.occurredAt).toISOString(),
        );
        await performAttendanceAction(pending.type, pending.occurredAt);
      } catch (error) {
        console.log(`${LOG_PREFIX} Replay failed:`, error?.message);
      }
    };

    /**
     * Resolves the office and makes sure the fence is registered.
     *
     * The office is resolved on EVERY run, not only when registration is needed:
     * `getOfficeLocation` takes a fresh GPS fix and returns `withinRadius`, which
     * is what reconcilePresence needs, and it is also the only thing that
     * populates `officeRef` — skipping it while already monitoring used to leave
     * that null, so a replayed log went out untagged.
     *
     * @returns {Promise<object|null>} the resolved office, or null when it could
     *          not be determined (no permission, no configured location, error).
     */
    const ensureMonitoring = async () => {
      try {
        const [foreground, background] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
        ]);
        if (
          foreground.status !== "granted" ||
          background.status !== "granted"
        ) {
          console.log(
            `${LOG_PREFIX} Location permission not granted yet, skipping`,
          );
          return null;
        }

        const nearest = await getOfficeLocation(employeeCode);
        if (cancelled || !nearest) return null;

        officeRef.current = nearest;

        // Registering is idempotent from the caller's perspective but not free:
        // re-adding an existing fence re-triggers the OS initial-state check and,
        // on iOS, briefly stops the region being monitored.
        if (!isMonitoring()) {
          await startGeofence({
            identifier: OFFICE_GEOFENCE_IDENTIFIER,
            latitude: nearest.latitude,
            longitude: nearest.longitude,
            radius: nearest.radius > 0 ? nearest.radius : 100,
          });
          console.log(`${LOG_PREFIX} Monitoring (re)established`, nearest);
        }

        return nearest;
      } catch (error) {
        console.log(
          `${LOG_PREFIX} Failed to (re)start monitoring:`,
          error?.message,
        );
        return null;
      }
    };

    /**
     * Answers "is the user inside the office right now?" instead of only "tell
     * me when they next cross the boundary".
     *
     * Both platforms ask the OS for the region state at registration time
     * (Android INITIAL_TRIGGER_ENTER, iOS requestState), but both answers are
     * best-effort: they depend on the OS having a usable location estimate, and
     * a stale one — the outside fix from a previous monitoring window — produces
     * no ENTER at all. Turning monitoring on inside the office then left the user
     * uncheck-ed-in with no recovery path, since replay only ever reconsiders the
     * single last native event and that one was already handled.
     *
     * So decide from the fix `ensureMonitoring` already took. The state machine
     * is the arbiter, so a native ENTER arriving afterwards is a harmless no-op.
     */
    const reconcilePresence = async (office) => {
      if (cancelled || !office?.withinRadius) return;

      const session = await readSession();
      if (isSessionActive(session)) return;

      console.log(
        `${LOG_PREFIX} Already inside ${office.locationName || "the office"} at startup; checking in`,
      );
      // Not a geofence transition: "now" is the only defensible timestamp, and
      // the replay high-water mark must not move (see performAttendanceAction).
      await performAttendanceAction("IN", Date.now(), { markProcessed: false });
    };

    // This effect re-runs for several reasons — login, the employee code
    // arriving, the policy syncing, an explicit sync request after a permission
    // grant — and two overlapping runs could both see isMonitoring() === false
    // and both register the same fence. Chaining onto the previous run keeps
    // exactly one startup sequence in flight, which is what makes this component
    // safe to be the sole registrar.
    //
    // Within a run the order matters. Replay first: a real missed crossing
    // carries the true crossing time, whereas presence reconciliation can only
    // ever claim "now", so letting presence go first would take the check-in slot
    // with a worse timestamp. Presence is the backstop for when the OS said
    // nothing at all.
    startupRef.current = startupRef.current
      .then(async () => {
        if (cancelled) return;
        const office = await ensureMonitoring();
        await replayPendingEvent();
        await reconcilePresence(office);
      })
      .catch((error) => {
        console.log(
          `${LOG_PREFIX} Startup reconciliation failed:`,
          error?.message,
        );
      });

    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [isLoggedIn, active, employeeCode, syncRequestId, dispatch]);

  return null;
}

import React, { useEffect, useRef } from "react";
import DurableAutoAttendanceBootstrap from "./DurableAutoAttendanceBootstrap";
import { useDispatch, useSelector } from "react-redux";
import * as Location from "expo-location";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectBaseUrl } from "../redux/Slices/UserSlice";
import {
  autoAttendanceMonitoringChanged,
  selectAutoAttendanceConfigured,
  selectAutoAttendanceGeotagging,
  selectAutoAttendanceScope,
  selectAutoAttendanceSyncRequestId,
} from "../redux/Slices/AutoAttendanceSlice";
import { setCheckin, setCheckout } from "../redux/Slices/AttendanceSlice";
import {
  isSessionActive,
  performSessionTransition,
  readSession,
  reconcileSessionFromServer,
  SESSION_ORIGIN,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";
import {
  getPersistedSessionTimes,
  normalizeCustomIn,
  resolveActiveSessionStart,
} from "../utils/attendanceSession";
import {
  autoCheckInOut,
  getAttendanceStatus,
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
  supportsDurableEvents,
} from "../modules/expo-auto-attendance";
import {
  evaluatePendingEvent,
  getLastProcessedEventAt,
  markEventProcessed,
  PENDING_EVENT,
} from "../utils/geofenceEventLog";
import {
  getQueueCounts,
  submitAutoAttendance,
} from "../services/offline/AttendanceQueueService";
import { syncNow } from "../services/offline/BackgroundSyncManager";
import { assertAttendanceQueueScope, captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { useFeatureEnabled } from "../hooks/useFeatureSettings";
import { ATTENDANCE_FEATURES } from "../utils/featureSettings";
import { assertCapability, assertCapabilityCurrent } from "../services/capabilityPolicy";
import { readLocationAccess } from "../utils/autoAttendance";
import {
  assertEmployeeAutoAttendancePolicy,
  getEmployeeAutoAttendancePolicy,
} from "../services/employeeAutoAttendancePolicy";

const LOG_PREFIX = "[AutoAttendanceBootstrap]";

// New binaries use the scoped journal bootstrap. The component below preserves
// import/runtime compatibility for binaries predating the additive native API.

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
 *  - retain unattributed historical transitions from older binaries without
 *    submitting them under the current account (see replayPendingEvent), and
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
  return typeof supportsDurableEvents === "function" && supportsDurableEvents()
    ? <DurableAutoAttendanceBootstrap /> : <LegacyAutoAttendanceBootstrap />;
}

function LegacyAutoAttendanceBootstrap() {
  const dispatch = useDispatch();
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const baseUrl = useSelector(selectBaseUrl);
  const employeeActive = useSelector(selectAutoAttendanceConfigured);
  const settingsScope = useSelector(selectAutoAttendanceScope);
  const employeeMode = useSelector(selectAutoAttendanceGeotagging);
  const capabilityAllowed = useFeatureEnabled(ATTENDANCE_FEATURES.AUTO_ATTENDANCE);
  const active = employeeActive && capabilityAllowed;
  const syncRequestId = useSelector(selectAutoAttendanceSyncRequestId);
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode,
  );

  // Read inside the listener closures without re-subscribing on every change.
  const capabilityAllowedRef = useRef(capabilityAllowed);
  capabilityAllowedRef.current = capabilityAllowed;
  const employeeActiveRef = useRef(employeeActive);
  employeeActiveRef.current = employeeActive;
  const employeeCodeRef = useRef(employeeCode);
  employeeCodeRef.current = employeeCode;
  // The office geofence's reporting location, captured when monitoring is
  // (re)established, so auto check-in/out can tag its log without a GPS fetch.
  const officeRef = useRef(null);
  // Serializes the startup sequence across effect runs — see the chain below.
  const startupRef = useRef(Promise.resolve());

  const assertAutomaticAllowed = async (scope) => {
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
    const policy = await assertEmployeeAutoAttendancePolicy(scope);
    // Employee/cache reception yields too: a tenant geo revocation received
    // during that work must apply before retaining monitoring or a new punch.
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
    return policy;
  };

  // Sync the server-side geotagging policy into Redux whenever we log in or the
  // employee changes. Uses the lightweight employee-data GET (no GPS); on
  // failure, restores only a scoped cache through the same policy receiver.
  useEffect(() => {
    if (!isLoggedIn || !employeeCode) return undefined;

    let cancelled = false;

    (async () => {
      let scope;
      try {
        scope = { ...await captureAttendanceQueueScope(employeeCode), isCancelled: () => cancelled };
        const employee = await fetchEmployeeData(employeeCode, { syncScope: scope });
        if (cancelled) return;
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
          if (scope && !cancelled) await getEmployeeAutoAttendancePolicy(scope);
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
  }, [isLoggedIn, employeeCode, baseUrl, dispatch]);

  useEffect(() => {
    if (!isAvailable()) return undefined;

    if (!isLoggedIn || !active) {
      stopGeofence().catch(() => {});
      return undefined;
    }

    if (!employeeCode) return undefined;

    let cancelled = false;
    // Only events observed during this registration have evidence of ownership.
    // Native replay from before it carries no backend identity and must not
    // become attendance for today's account.
    const scopeObservedAt = Date.now();
    const queueScope = captureAttendanceQueueScope(employeeCode)
      .then(scope => ({ ...scope, isCancelled: () => cancelled })).catch(() => null);

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
    /**
     * Counts this employee's punches that could still change the server's view
     * of the session.
     *
     * `mayAffectServerCount`, and the exclusions are the whole point:
     *
     *  - REJECTED is out because the server has already refused those. Its "no
     *    open session" is correct about them, and counting them would block
     *    automatic check-in forever on a punch that is never coming. (This is
     *    the same choice the manual screen's guard makes.)
     *  - BLOCKED on `endpoint-missing` is out for the same reason in a different
     *    disguise: that row is waiting on a deployment, is kept forever, and
     *    would otherwise hold this guard shut permanently on any tenant without
     *    the offline endpoint. Blocked on auth or configuration still counts —
     *    those resolve by themselves and the row really can still land.
     *
     * Fails open at 0. A queue read that throws must not be able to disable
     * automatic attendance.
     */
    const countAwaitingServer = async (code) =>
      getQueueCounts(code)
        .then((counts) => counts?.mayAffectServerCount ?? 0)
        .catch((error) => {
          console.log(`${LOG_PREFIX} Queue count failed:`, error?.message);
          return 0;
        });

    const performAttendanceAction = async (
      type,
      occurredAt,
      { markProcessed = true, observedLive = false } = {},
    ) => {
      const recordHandled = async (at) => {
        if (markProcessed) await markEventProcessed(at);
      };

      // Keep legacy replay evidence when tenant settings suspend actions. A
      // native crossing is location evidence, not authority to submit a punch.
      if (cancelled || !capabilityAllowedRef.current) return;

      // Transient, not a decision: retry on the next launch once it is known.
      const code = employeeCodeRef.current;
      if (!code) return;

      try {
        const sourceScope = observedLive && Number.isFinite(occurredAt) && occurredAt >= scopeObservedAt
          ? await queueScope : null;
        // Older native records have no capture-time owner. Current credentials
        // cannot authorize another account's historical crossing. Keep its
        // native evidence and high-water mark intact for review.
        if (!sourceScope) return;
        await assertAttendanceQueueScope(sourceScope);
        const policy = await getEmployeeAutoAttendancePolicy(sourceScope);
        // Warnings-only observations are handled without creating attendance.
        // Disabled/unknown policies retain the event instead of authorizing it.
        if (policy?.mode === 1) {
          await recordHandled(occurredAt);
          return;
        }
        const assertPunchAllowed = () => assertAutomaticAllowed(sourceScope);
        await assertPunchAllowed();
        // Same queue the manual screens use, differing only in `attendanceType`
        // and in which API call it wraps. A geofence crossing is precisely when
        // the network is least reliable — a car park, a basement, a site with no
        // signal — so this is the path that most needs to survive being offline.
        const outcome = await performSessionTransition({
          type,
          origin: SESSION_ORIGIN.AUTO,
          at: occurredAt,
          assertCurrent: () => assertAttendanceQueueScope(sourceScope),
          execute: async () => {
            await assertPunchAllowed();
            // A check-in must never overtake a punch the server has not seen.
            // The OS can deliver an ENTER the instant the fence is registered at
            // login — before the startup drain has uploaded the check-out that
            // was queued while the employee was offline — and sending this IN
            // directly would file it against a session the server still has
            // open. Queueing puts it behind that check-out in the employee's
            // FIFO, so the server receives OUT then IN.
            //
            // Only the IN direction. An OUT closes a session, and delaying one
            // behind an earlier punch is what the queue's ordering already does
            // for it anyway.
            //
            // Evaluated here rather than before `performSessionTransition`
            // because `execute` runs while that function holds the session lock:
            // no other transition for this employee can enqueue between this
            // count and the submission below. The drain may still finish an
            // upload in that window, which is harmless — it can only turn "queue
            // it" into an unnecessary queue, never the reverse.
            const forceQueue =
              type === "IN" && (await countAwaitingServer(code)) > 0;

            if (forceQueue) {
              console.log(
                `${LOG_PREFIX} Queueing auto IN behind an undelivered punch to preserve order`,
              );
            }

            await assertPunchAllowed();
            return submitAutoAttendance({
              type,
              employeeCode: code,
              occurredAt,
              forceQueue,
              sourceScope,
              online: async () => {
                await assertPunchAllowed();
                return autoCheckInOut({
                  employeeCode: code,
                  type,
                  office: officeRef.current,
                  occurredAt,
                  syncScope: sourceScope,
                });
              },
            });
          },
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
          const where = officeName ? `You left ${officeName}` : "You left the office";

          // A queued punch is accepted locally, not recorded on the server. The
          // old copy said "you've been checked out automatically" either way,
          // which is how an employee came to believe a check-out had been filed
          // when it was still in SQLite — and then could not explain the gap.
          // Say which one it is.
          presentLocalNotification({
            title: outcome.queued ? "Checked out offline" : "Checked out",
            body: outcome.queued
              ? `${where}, so you've been checked out on this device. It will sync when you're back online.`
              : `${where}, so ${startedManually ? "your check-in was closed" : "you've been checked out"} automatically.`,
            data: {
              type: "auto-checkout",
              pendingSync: outcome.queued,
            },
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
        performAttendanceAction("IN", event?.timestamp, { observedLive: true }),
      ),
      addGeofenceExitListener((event) =>
        performAttendanceAction("OUT", event?.timestamp, { observedLive: true }),
      ),
    ];

    /**
     * Inspects the older native binary's last transition. It has no original
     * tenant/employee metadata, so an actionable historical event is retained
     * without attendance submission. Existing expiry/high-water rules remain;
     * provenance-aware replay is available through the durable bootstrap.
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

        // An older binary cannot prove which tenant/employee captured this
        // record. Retain it; only a fresh observed event may create attendance.
        console.log(`${LOG_PREFIX} Retaining native event without capture-time ownership`);
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
        const sourceScope = await queueScope;
        if (!sourceScope) return null;
        const assertMonitoringAllowed = () => assertAutomaticAllowed(sourceScope);
        await assertMonitoringAllowed();
        const [foreground, background] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
        ]);
        await assertMonitoringAllowed();
        if (
          foreground.status !== "granted" ||
          background.status !== "granted"
        ) {
          console.log(
            `${LOG_PREFIX} Location permission not granted yet, skipping`,
          );
          return null;
        }

        const nearest = await getOfficeLocation(employeeCode, { syncScope: sourceScope });
        await assertMonitoringAllowed();
        if (!nearest) return null;

        officeRef.current = nearest;

        // Registering is idempotent from the caller's perspective but not free:
        // re-adding an existing fence re-triggers the OS initial-state check and,
        // on iOS, briefly stops the region being monitored.
        if (!isMonitoring()) {
          // A same-owner sync request replaces this JS effect while its native
          // start is pending. Preserve that registration if current employee
          // policy still permits it; owner/generation changes remain invalid.
          const registrationScope = { ...sourceScope };
          delete registrationScope.isCancelled;
          await startGeofence({
            identifier: OFFICE_GEOFENCE_IDENTIFIER,
            latitude: nearest.latitude,
            longitude: nearest.longitude,
            radius: nearest.radius > 0 ? nearest.radius : 100,
          }, registrationScope);
          // A native registration may complete after policy or login changes.
          // Remove that late registration before retaining monitoring.
          try {
            await assertAutomaticAllowed(registrationScope);
            if (!employeeActiveRef.current || !capabilityAllowedRef.current) {
              await stopGeofence();
              return null;
            }
          } catch (error) {
            await stopGeofence();
            throw error;
          }
          if (cancelled) return null;
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
     *
     * ## Why a local CHECKED_OUT is not enough on its own
     *
     * This used to check in on exactly two facts: the device is inside the fence,
     * and the local record says CHECKED_OUT. That is unsound right after an
     * authentication recovery, because the local record can describe a check-out
     * the server has never seen — a punch queued while offline, whose upload the
     * token expiry interrupted. Acting on it filed a second check-in on top of a
     * session the server still had open, and the employee's day showed IN, IN
     * with no OUT between them.
     *
     * So the order below is evidence-first, and it is the same order (and the
     * same helpers) the manual screen already uses in `syncCheckinFromStatus`:
     *
     *   1. anything queued  → drain it, and do not open a session this pass;
     *   2. ask the server   → an open session there wins over the local record;
     *   3. only then        → the local CHECKED_OUT is corroborated, check in.
     *
     * Step 2 is skipped when the server cannot be reached AND nothing is queued.
     * "No answer" is not "no session", but with an empty outbox the local record
     * is the best evidence available and refusing here would break automatic
     * check-in for the offline case the queue exists to serve. The dangerous
     * version of that case — a punch the server has not seen — is precisely what
     * step 1 has already excluded.
     */
    const reconcilePresence = async (office) => {
      if (cancelled || !office?.withinRadius) return;

      const session = await readSession();
      if (isSessionActive(session)) return;

      const code = employeeCodeRef.current;

      // 1. Unsynchronised punches. The local CHECKED_OUT may be one of them, in
      //    which case the server's session is still open and a check-in now
      //    would duplicate it. Drain first, then re-count: a successful sync
      //    makes the server authoritative again and the pass can continue.
      if (code && (await countAwaitingServer(code)) > 0) {
        console.log(`${LOG_PREFIX} Queued punches outstanding; syncing before presence check-in`);
        try {
          // Scoped explicitly: this can run before the background sync manager
          // has been told who is logged in, and an unscoped drain would refuse.
          await syncNow({ trigger: "auto-attendance-presence", employeeId: code });
        } catch (error) {
          console.log(`${LOG_PREFIX} Presence sync failed:`, error?.message);
        }

        if (cancelled) return;

        if ((await countAwaitingServer(code)) > 0) {
          console.log(
            `${LOG_PREFIX} Punches still awaiting the server; not opening a new session`,
          );
          return;
        }
      }

      // 2. The server's own answer. `getAttendanceStatus` is the existing
      //    authority — no new endpoint — and it distinguishes "no session" from
      //    "no answer" via `unavailable`, which is the distinction this depends
      //    on.
      const fetchedAt = Date.now();
      const status = await getAttendanceStatus().catch((error) => {
        console.log(`${LOG_PREFIX} Status check failed:`, error?.message);
        return { unavailable: true };
      });

      if (cancelled) return;

      if (!status?.unavailable && normalizeCustomIn(status?.custom_in) === 1) {
        console.log(
          `${LOG_PREFIX} Server reports an open session; restoring it instead of checking in`,
        );

        // Best-effort restore of the local record. `resolveActiveSessionStart`
        // can decline to name a start (it rejects one at or before the local
        // check-out floor, which is exactly the stale floor this situation
        // creates), and that is fine — not checking in is the load-bearing part.
        const { checkinStartTime, lastCheckoutTime } =
          await getPersistedSessionTimes();
        const resolvedStart = resolveActiveSessionStart({
          status,
          storedCheckinStartTime: checkinStartTime,
          reduxCheckinTime: null,
          lastCheckoutTime,
        });

        if (resolvedStart) {
          const restored = await reconcileSessionFromServer({
            activeStartedAt: resolvedStart,
            fetchedAt,
          });
          if (isSessionActive(restored)) {
            dispatch(
              setCheckin({
                checkinTime: restored.startedAt,
                location: null,
                sessionOrigin: restored.origin,
              }),
            );
          }
        }

        return;
      }

      // A current fix cannot prove a crossing. Initial attendance requires the
      // OS initial-state ENTER callback, including on older native binaries.
    };

    // This effect re-runs for several reasons — login, the employee code
    // arriving, the policy syncing, an explicit sync request after a permission
    // grant — and two overlapping runs could both see isMonitoring() === false
    // and both register the same fence. Chaining onto the previous run keeps
    // exactly one startup sequence in flight, which is what makes this component
    // safe to be the sole registrar.
    //
    // Historical records remain unowned. Presence only restores server state;
    // a location snapshot must never supply an attendance transition.
    startupRef.current = startupRef.current
      .then(async () => {
        if (cancelled) return;
        const office = await ensureMonitoring();
        // Status only: a failed permission read must not hold up the replay.
        const state = office && isMonitoring() ? "active"
          : (await readLocationAccess().catch(() => null))?.granted ? "unavailable" : "permission";
        if (!cancelled) dispatch(autoAttendanceMonitoringChanged({ scope: settingsScope, state }));
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
  }, [isLoggedIn, active, employeeMode, employeeCode, baseUrl, settingsScope, syncRequestId, dispatch]);

  return null;
}

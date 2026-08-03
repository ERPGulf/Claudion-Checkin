import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearPersistedCheckinStartTime,
  getPersistedSessionTimes,
  persistCheckinStartTime,
  persistCheckoutTime,
  toTimestampMs,
} from "./attendanceSession";

/**
 * Durable attendance-session state machine.
 *
 * Both entry points into attendance — the manual screens (AttendanceAction /
 * AttendanceCamera) and the office geofence (AutoAttendanceBootstrap) — drive
 * the SAME two-state machine here instead of each keeping their own idea of
 * whether a session is open:
 *
 *      CHECKED_OUT --(IN)--> CHECKED_IN --(OUT)--> CHECKED_OUT
 *
 * The record remembers HOW the open session started (`origin`) and how it was
 * closed (`closedBy`), which is what makes "manual check-in → automatic
 * check-out" work: a geofence EXIT closes whatever session is open, regardless
 * of who opened it, and is a no-op when none is.
 *
 * Why AsyncStorage and not Redux: the geofence listeners run after an OS
 * background relaunch, in a JS context that may have been created seconds
 * earlier. Redux (via redux-persist) rehydrates from the same storage but is
 * not guaranteed to be current at listener time, so this record — written
 * synchronously with each committed transition — is the source of truth.
 * Redux mirrors it for the UI.
 *
 * `checkinStartTime` / `lastCheckoutTime` (utils/attendanceSession.js) are kept
 * in sync on every commit: they remain the inputs to resolveActiveSessionStart,
 * which reconciles against the server on screen focus.
 */

export const SESSION_STATE_KEY = "attendanceSessionState";

export const SESSION_STATUS = {
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
};

/** How a session was started, or what closed it. */
export const SESSION_ORIGIN = {
  MANUAL: "MANUAL",
  AUTO: "AUTO",
  /** Pre-existing session adopted from the server or from legacy storage. */
  UNKNOWN: "UNKNOWN",
};

/** Outcome of an attempted transition. */
export const TRANSITION_RESULT = {
  /** The transition ran and the state moved. */
  COMPLETED: "completed",
  /** The machine was already in the target state — nothing was sent. */
  SKIPPED: "skipped",
  /** The backend refused; the state did not move. */
  FAILED: "failed",
};

const CLOSED_SESSION = Object.freeze({
  status: SESSION_STATUS.CHECKED_OUT,
  origin: null,
  startedAt: null,
  endedAt: null,
  closedBy: null,
});

const isOrigin = (value) =>
  value === SESSION_ORIGIN.MANUAL ||
  value === SESSION_ORIGIN.AUTO ||
  value === SESSION_ORIGIN.UNKNOWN;

const normalizeOrigin = (value, fallback = null) =>
  isOrigin(value) ? value : fallback;

/**
 * Coerces anything read back from storage into a well-formed record. `status`
 * is authoritative: a CHECKED_IN record with an unreadable `startedAt` is still
 * an open session (so it can be closed), just one without a known start.
 */
const normalizeSession = (raw) => {
  if (!raw || typeof raw !== "object") return { ...CLOSED_SESSION };

  const startedAt = toTimestampMs(raw.startedAt);
  const endedAt = toTimestampMs(raw.endedAt);

  if (raw.status === SESSION_STATUS.CHECKED_IN) {
    return {
      status: SESSION_STATUS.CHECKED_IN,
      origin: normalizeOrigin(raw.origin, SESSION_ORIGIN.UNKNOWN),
      startedAt,
      endedAt: null,
      closedBy: null,
    };
  }

  return {
    status: SESSION_STATUS.CHECKED_OUT,
    origin: normalizeOrigin(raw.origin),
    startedAt,
    endedAt,
    closedBy: normalizeOrigin(raw.closedBy),
  };
};

/**
 * Builds a record for a device that checked in before this module existed (an
 * OTA update landing mid-session), from the legacy timestamp keys. The origin
 * of such a session is genuinely unknowable, which is harmless: a check-out is
 * allowed from any origin.
 */
const deriveSessionFromLegacyTimes = async () => {
  const { checkinStartTime, lastCheckoutTime } =
    await getPersistedSessionTimes();

  const hasOpenSession =
    Number.isFinite(checkinStartTime) &&
    (!Number.isFinite(lastCheckoutTime) || checkinStartTime > lastCheckoutTime);

  if (hasOpenSession) {
    return {
      status: SESSION_STATUS.CHECKED_IN,
      origin: SESSION_ORIGIN.UNKNOWN,
      startedAt: checkinStartTime,
      endedAt: null,
      closedBy: null,
    };
  }

  return {
    ...CLOSED_SESSION,
    endedAt: Number.isFinite(lastCheckoutTime) ? lastCheckoutTime : null,
  };
};

const writeSession = async (session) => {
  const normalized = normalizeSession(session);
  await AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify(normalized));
  return normalized;
};

const readSessionUnlocked = async () => {
  let stored = null;

  try {
    stored = await AsyncStorage.getItem(SESSION_STATE_KEY);
  } catch {
    return { ...CLOSED_SESSION };
  }

  if (stored != null) {
    try {
      return normalizeSession(JSON.parse(stored));
    } catch {
      // Corrupt record — fall through to the legacy derivation below.
    }
  }

  const migrated = await deriveSessionFromLegacyTimes();
  await writeSession(migrated).catch(() => {});
  return migrated;
};

// ----------------------
// TRANSITION SERIALIZATION
// ----------------------
// Geofence transitions arrive from native code and can land while a manual tap
// is still in flight (or twice in a row when GPS jitters at the boundary).
// Every state-changing operation — including the API call it wraps — runs
// through this queue, so a second check-out can never observe the pre-checkout
// state and duplicate the log.
let transitionQueue = Promise.resolve();

const withSessionLock = (task) => {
  const settled = transitionQueue.then(task, task);
  transitionQueue = settled.then(
    () => undefined,
    () => undefined,
  );
  return settled;
};

/** Current session record; migrates legacy storage on first read. */
export const readSession = () => withSessionLock(readSessionUnlocked);

export const isSessionActive = (session) =>
  session?.status === SESSION_STATUS.CHECKED_IN;

/**
 * Whether `type` is a legal move from `session`. This is the single rule that
 * makes every supported combination work:
 *   - IN is legal only when no session is open (blocks duplicate check-ins),
 *   - OUT is legal only when one is (blocks duplicate check-outs, and makes an
 *     auto check-out after a manual check-out a no-op).
 */
export const canTransition = (session, type) =>
  type === "IN"
    ? !isSessionActive(session)
    : type === "OUT" && isSessionActive(session);

const commitCheckIn = async ({ origin, at }) => {
  const startedAt = await persistCheckinStartTime(at ?? Date.now());

  return writeSession({
    status: SESSION_STATUS.CHECKED_IN,
    origin: normalizeOrigin(origin, SESSION_ORIGIN.UNKNOWN),
    startedAt,
    endedAt: null,
    closedBy: null,
  });
};

const commitCheckOut = async ({ session, origin, at }) => {
  const endedAt = await persistCheckoutTime(at ?? Date.now());

  // The closed record keeps the ended session's origin so callers can tell
  // "your manual check-in was closed automatically" from a fully automatic day.
  return writeSession({
    status: SESSION_STATUS.CHECKED_OUT,
    origin: session?.origin ?? null,
    startedAt: session?.startedAt ?? null,
    endedAt,
    closedBy: normalizeOrigin(origin, SESSION_ORIGIN.UNKNOWN),
  });
};

/**
 * Runs one attendance transition end to end: check the state machine, call the
 * backend, and commit only if the backend accepted.
 *
 * @param {object} options
 * @param {"IN"|"OUT"} options.type
 * @param {"MANUAL"|"AUTO"} options.origin who is performing the transition
 * @param {() => Promise<{allowed: boolean, message?: string}>} options.execute
 *        the API call (`userCheckIn` or `autoCheckInOut`). Runs only when the
 *        transition is legal. Rejections propagate to the caller, uncommitted.
 * @param {number} [options.at] commit timestamp, defaults to now
 * @returns {Promise<{status: string, session: object, previousSession: object,
 *                    response?: object}>}
 *          `status` is one of TRANSITION_RESULT. On SKIPPED, `session` is the
 *          unchanged current state — callers can use it to re-sync their UI.
 */
export const performSessionTransition = async ({
  type,
  origin,
  execute,
  at,
}) => {
  if (type !== "IN" && type !== "OUT") {
    throw new Error(`Invalid attendance transition: ${type}`);
  }

  return withSessionLock(async () => {
    const previousSession = await readSessionUnlocked();

    if (!canTransition(previousSession, type)) {
      return {
        status: TRANSITION_RESULT.SKIPPED,
        session: previousSession,
        previousSession,
      };
    }

    const response = await execute();

    if (!response?.allowed) {
      return {
        status: TRANSITION_RESULT.FAILED,
        session: previousSession,
        previousSession,
        response,
      };
    }

    const session =
      type === "IN"
        ? await commitCheckIn({ origin, at })
        : await commitCheckOut({ session: previousSession, origin, at });

    return {
      status: TRANSITION_RESULT.COMPLETED,
      session,
      previousSession,
      response,
    };
  });
};

/**
 * Aligns the local machine with the server's view of the session, as resolved
 * by resolveActiveSessionStart(). Called on the attendance screen's mount and
 * focus syncs so a session created on another device — or a check-out done in
 * the ERPNext desk — is reflected here, and so the geofence never closes a
 * session the server no longer considers open.
 *
 * Adopting an unknown session keeps auto check-out working for it; that is
 * deliberate, since a session the user cannot see is worse than one closed on
 * leaving the office.
 *
 * @param {object} options
 * @param {number|null} options.activeStartedAt resolved session start, or null
 *        when the server reports no open session
 * @param {string} [options.origin] origin to record when adopting a session
 *        this device did not open
 * @param {number} [options.fetchedAt] when the status request that produced
 *        `activeStartedAt` was issued. Supply it whenever the value came from a
 *        network call: a session opened after that moment cannot be described by
 *        the response, so the response must not be allowed to close or backdate
 *        it (see the guard below).
 */
export const reconcileSessionFromServer = async ({
  activeStartedAt,
  origin = SESSION_ORIGIN.UNKNOWN,
  fetchedAt = null,
}) =>
  withSessionLock(async () => {
    const session = await readSessionUnlocked();
    const startedAt = toTimestampMs(activeStartedAt);

    // A session that opened after the status request was issued cannot appear in
    // that response, so the response says nothing about it. Without this, an
    // automatic check-in landing while the request is in flight would be undone
    // a moment later: the "no open session" branch below clears the record and
    // the screen dispatches resetCheckin(). The check-out direction has its own
    // guard (`isStale`) further down; this is the same protection for check-in.
    //
    // `>=`, not `>`: a session that started in the same millisecond the request
    // was issued may or may not be in the response, and the two failure modes are
    // not symmetric. Keeping it costs at most one stale-looking session until the
    // next sync — which is issued strictly later, so it resolves it. Dropping it
    // loses a real check-in.
    const fetchedAtMs = toTimestampMs(fetchedAt);
    if (
      Number.isFinite(fetchedAtMs) &&
      isSessionActive(session) &&
      Number.isFinite(session.startedAt) &&
      session.startedAt >= fetchedAtMs
    ) {
      return session;
    }

    // The status this was resolved from was fetched before the lock was taken,
    // so a check-out may have committed in between (a geofence EXIT while the
    // request was in flight). Re-check the start against the current check-out
    // floor here, under the lock, or a stale response would re-open a session
    // that has just been closed.
    const { lastCheckoutTime } = await getPersistedSessionTimes();
    const isStale =
      Number.isFinite(lastCheckoutTime) &&
      Number.isFinite(startedAt) &&
      startedAt <= lastCheckoutTime;

    if (startedAt && !isStale) {
      // Keep the known origin of a session we already track; only adopt the
      // supplied origin when taking over one we did not open.
      const resolvedOrigin = isSessionActive(session)
        ? session.origin
        : normalizeOrigin(origin, SESSION_ORIGIN.UNKNOWN);

      await persistCheckinStartTime(startedAt);

      return writeSession({
        status: SESSION_STATUS.CHECKED_IN,
        origin: resolvedOrigin,
        startedAt,
        endedAt: null,
        closedBy: null,
      });
    }

    await clearPersistedCheckinStartTime();

    if (!isSessionActive(session)) return session;

    // The server says the session is gone but we still had one open. Close it
    // without touching `lastCheckoutTime`: that key is the floor used to reject
    // stale server check-ins, and this is a correction, not a check-out.
    return writeSession({
      status: SESSION_STATUS.CHECKED_OUT,
      origin: session.origin,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      closedBy: SESSION_ORIGIN.UNKNOWN,
    });
  });

/** Drops the record entirely (user switch / logout). */
export const clearSessionState = async () => {
  await AsyncStorage.removeItem(SESSION_STATE_KEY);
};

export default {
  SESSION_STATUS,
  SESSION_ORIGIN,
  TRANSITION_RESULT,
  canTransition,
  clearSessionState,
  isSessionActive,
  performSessionTransition,
  readSession,
  reconcileSessionFromServer,
};

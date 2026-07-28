import AsyncStorage from "@react-native-async-storage/async-storage";

import { toTimestampMs } from "./attendanceSession";

/**
 * Bookkeeping for geofence transitions that native code recorded but JS never
 * acted on.
 *
 * The OS delivers ENTER/EXIT to native code even when the app is killed, but
 * the native handlers only persist the transition (`getLastEvent()`) — the
 * attendance call needs JS, which is not running. Nothing replayed those, so a
 * check-out could be lost until the user next opened the app and pressed a
 * button.
 *
 * This module answers one question: is the last transition native saw still
 * unprocessed? It records a high-water mark of the newest event JS has handled,
 * so a live event and its replay can never both fire, and so an event is not
 * re-applied on every subsequent launch.
 *
 * The native record is deliberately left alone (`clearLastEvent()` is never
 * called here) — the AutoAttendance screen shows it as "Last change".
 */

export const LAST_PROCESSED_EVENT_KEY = "autoAttendanceLastProcessedEventAt";

/** Transitions older than this are recorded as handled but never replayed. */
export const MAX_REPLAY_AGE_MS = 24 * 60 * 60 * 1000;

/** Tolerance for a device clock that is slightly ahead of the event source. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

export const PENDING_EVENT = {
  /** Should be replayed now. */
  READY: "ready",
  /** Nothing to do — no event, or JS already handled it. */
  NONE: "none",
  /** Too old (or impossibly dated) to act on; mark handled and move on. */
  EXPIRED: "expired",
};

const TRANSITION_TO_TYPE = { ENTER: "IN", EXIT: "OUT" };

/**
 * Decides what to do with the last transition native recorded. Pure — the
 * caller supplies the native record and the stored high-water mark.
 *
 * @param {object} options
 * @param {{transition: string, timestamp: number}|null} options.lastEvent
 * @param {number|null} options.lastProcessedAt
 * @returns {{status: string, type?: "IN"|"OUT", occurredAt?: number}}
 */
export const evaluatePendingEvent = ({
  lastEvent,
  lastProcessedAt,
  nowMs = Date.now(),
  maxAgeMs = MAX_REPLAY_AGE_MS,
}) => {
  const occurredAt = toTimestampMs(lastEvent?.timestamp);
  const type = TRANSITION_TO_TYPE[lastEvent?.transition];

  if (!occurredAt || !type) return { status: PENDING_EVENT.NONE };

  const processedAt = toTimestampMs(lastProcessedAt);
  if (Number.isFinite(processedAt) && occurredAt <= processedAt) {
    return { status: PENDING_EVENT.NONE };
  }

  // A timestamp from the future means the device clock moved; acting on it
  // would write a nonsense attendance log.
  if (occurredAt > nowMs + FUTURE_TOLERANCE_MS) {
    return { status: PENDING_EVENT.EXPIRED, type, occurredAt };
  }

  if (nowMs - occurredAt > maxAgeMs) {
    return { status: PENDING_EVENT.EXPIRED, type, occurredAt };
  }

  return { status: PENDING_EVENT.READY, type, occurredAt };
};

export const getLastProcessedEventAt = async () => {
  try {
    return toTimestampMs(await AsyncStorage.getItem(LAST_PROCESSED_EVENT_KEY));
  } catch {
    return null;
  }
};

/** Advances the high-water mark; never moves it backwards. */
export const markEventProcessed = async (occurredAt) => {
  const occurredAtMs = toTimestampMs(occurredAt);
  if (!occurredAtMs) return;

  const processedAt = await getLastProcessedEventAt();
  if (Number.isFinite(processedAt) && occurredAtMs <= processedAt) return;

  await AsyncStorage.setItem(LAST_PROCESSED_EVENT_KEY, String(occurredAtMs));
};

export const clearProcessedEventMark = async () => {
  await AsyncStorage.removeItem(LAST_PROCESSED_EVENT_KEY);
};

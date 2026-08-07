import AsyncStorage from "@react-native-async-storage/async-storage";
import { format } from "date-fns";

/**
 * Stamping an attendance log when the server cannot be asked.
 *
 * Online, every punch takes its timestamp from `get_server_time`, so device
 * clock drift never reaches the record. Offline that call is exactly what is
 * unavailable — and the device clock is not a safe substitute on its own. Phones
 * run minutes out, and a user who wants an earlier check-in can simply set it
 * back.
 *
 * So the offset between the two clocks is measured whenever the server IS
 * reachable and reused while it is not. A punch queued offline is stamped
 * `device now + last known offset`, which is right to within the drift
 * accumulated since the last online moment — hours, typically, over which a
 * phone clock moves by well under a second.
 *
 * The offset is a delta, not an absolute time, so it survives the device clock
 * being changed *between* sessions. It cannot survive the clock being changed
 * mid-outage; nothing local can.
 */

export const SERVER_OFFSET_KEY = "serverClockOffset";

/** Frappe's naive-datetime format. Shared with the online attendance calls. */
export const SERVER_TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";

const SERVER_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * Reads the server's wall clock into a local Date carrying the SAME digits.
 *
 * The server sends a naive datetime with no offset and engines disagree on how
 * to parse that, so the components are read explicitly rather than via
 * Date.parse.
 */
export const parseServerWallClock = (value) => {
  const match = SERVER_TIME_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;

  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  const parsed = new Date(year, month - 1, day, hours, minutes, seconds);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * An offset this large is not clock drift — it is a device in the wrong
 * timezone, or a server response that was never a timestamp. Applying it would
 * move a punch by days, so it is discarded and the raw device clock used
 * instead, which is wrong by minutes at worst.
 */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000;

let cachedOffsetMs = null;

/**
 * Records the gap between server and device clocks. Called on every successful
 * `getServerTime()`, so the offset is as fresh as the last time the app spoke to
 * the backend.
 *
 * @returns {number|null} the offset stored, or null when it was not usable
 */
export const rememberServerOffset = async (
  serverTime,
  deviceNowMs = Date.now(),
) => {
  const wallClock = parseServerWallClock(serverTime);
  if (!wallClock) return null;

  const offsetMs = wallClock.getTime() - deviceNowMs;
  if (Math.abs(offsetMs) > MAX_PLAUSIBLE_OFFSET_MS) return null;

  cachedOffsetMs = offsetMs;

  try {
    await AsyncStorage.setItem(SERVER_OFFSET_KEY, String(offsetMs));
  } catch {
    // In-memory value still applies for this session.
  }

  return offsetMs;
};

/** The last recorded offset, or 0 when none has ever been recorded. */
export const getServerOffset = async () => {
  if (cachedOffsetMs !== null) return cachedOffsetMs;

  try {
    const stored = await AsyncStorage.getItem(SERVER_OFFSET_KEY);
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= MAX_PLAUSIBLE_OFFSET_MS) {
      cachedOffsetMs = parsed;
      return parsed;
    }
  } catch {
    // Fall through to zero.
  }

  return 0;
};

/**
 * A server-format timestamp for something that happened at `atMs` on the device
 * clock, corrected by the last known offset.
 *
 * @param {number} [atMs] device epoch ms; defaults to now
 * @returns {Promise<string>} e.g. "2026-07-28 01:00:00"
 */
export const formatOfflineTimestamp = async (atMs = Date.now()) => {
  const offset = await getServerOffset();
  const at = Number.isFinite(atMs) ? atMs : Date.now();
  return format(new Date(at + offset), SERVER_TIMESTAMP_FORMAT);
};

/** Test seam. */
export const resetServerClockCache = () => {
  cachedOffsetMs = null;
};

export default {
  SERVER_OFFSET_KEY,
  SERVER_TIMESTAMP_FORMAT,
  formatOfflineTimestamp,
  getServerOffset,
  parseServerWallClock,
  rememberServerOffset,
  resetServerClockCache,
};

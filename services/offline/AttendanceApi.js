// src/services/offline/AttendanceApi.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../api/apiClient";
import { cleanBaseUrl } from "../api/utils";
import { actionToLogType } from "./AttendanceDatabase";
import {
  FAILURE_KIND,
  cleanServerMessage,
  isDuplicateMessage,
} from "./attendanceErrors";

/**
 * Uploading a queued punch.
 *
 * Uses `add_offline_employee_checkins`, the bulk endpoint, rather than the
 * `add_log_based_on_employee_field` call the online path uses. The bulk endpoint
 * is the one that reports a pre-existing log as a structured per-record failure
 * instead of a blanket error, which is what makes the duplicate-is-success rule
 * implementable at all.
 *
 * It accepts a list, but this sends exactly one record per request. Its response
 * returns `inserted` as a flat array of docnames with no correlation back to the
 * inputs, so with a mixed batch there is no reliable way to say which docname
 * belongs to which punch — and putting the wrong `serverCheckinId` on a row
 * would corrupt the history merge silently. One punch per request makes the
 * mapping exact, and the cost is trivial: a queue is a handful of rows, not
 * thousands.
 */

export const OFFLINE_CHECKIN_METHOD =
  "employee_app.attendance_api.add_offline_employee_checkins";

/** Matches the online path, so `describeLogSource` hides it in history alike. */
export const DEVICE_ID = "MobileAPP";

/** What the sync service does next with a row. */
export const PUSH_RESULT = {
  INSERTED: "inserted",
  DUPLICATE: "duplicate",
  REJECTED: "rejected",
};

/**
 * Frappe usually nests a whitelisted method's return under `message`, but this
 * endpoint has been observed returning the object at the top level too. Both are
 * accepted rather than guessing, since guessing wrong turns every sync into an
 * unparseable success.
 */
const unwrap = (data) => {
  if (data?.message && typeof data.message === "object") return data.message;
  if (data?.data && typeof data.data === "object") return data.data;
  return data ?? {};
};

/**
 * Builds the record the endpoint expects.
 *
 * Deliberately limited to the six documented fields. A bulk insert that is
 * handed keys it does not know about can reject the whole call, and a rejection
 * here is indistinguishable from a real validation failure — so coordinates ride
 * in the `location` string (the same "lat, lng" form `userCheckIn` already uses
 * for unrestricted check-outs) rather than as extra keys. Full precision is kept
 * on the local row regardless.
 */
export const buildCheckinRecord = (row) => {
  const payload = row?.payload ?? {};

  const location =
    payload.location ??
    row?.address ??
    (Number.isFinite(row?.latitude) && Number.isFinite(row?.longitude)
      ? `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`
      : undefined);

  const record = {
    // The docname when the config cache managed to resolve one, the scanned
    // employee code otherwise — see attendanceConfigCache#resolveEmployeeDocname
    // for why this is not simply one or the other.
    employee: row?.employeeDocname || row?.employeeId,
    timestamp: row?.timestamp,
    device_id: row?.deviceId || DEVICE_ID,
    log_type: actionToLogType(row?.action),
    over_time: payload.over_time ?? 0,
  };

  if (location) record.location = location;

  return record;
};

/**
 * Reads a single-record response into an outcome.
 *
 * The endpoint's three statuses (`success` / `partial_success` / `error`) are
 * not read directly, because with one record in the batch the per-record arrays
 * say everything and the status adds nothing. What matters is: is there an
 * inserted docname, and if not, is the failure a duplicate?
 */
export const interpretPushResponse = (body) => {
  const response = unwrap(body);

  const inserted = Array.isArray(response?.inserted) ? response.inserted : [];
  const failed = Array.isArray(response?.failed) ? response.failed : [];

  if (inserted.length) {
    return {
      result: PUSH_RESULT.INSERTED,
      serverCheckinId: inserted[0] ?? null,
      message: cleanServerMessage(response?.message) || "Attendance recorded",
      response,
    };
  }

  const failure = failed[0];
  const failureMessage = failure?.error ?? response?.message ?? "";

  if (isDuplicateMessage(failureMessage)) {
    return {
      result: PUSH_RESULT.DUPLICATE,
      // The message carries a link to the existing doc but not its id in a
      // parseable field, so the row records the message and leaves
      // serverCheckinId null. The history merge matches on timestamp anyway.
      serverCheckinId: null,
      message:
        cleanServerMessage(failureMessage) ||
        "This attendance was already recorded",
      response,
    };
  }

  return {
    result: PUSH_RESULT.REJECTED,
    kind: FAILURE_KIND.TERMINAL,
    message:
      cleanServerMessage(failureMessage) ||
      cleanServerMessage(response?.message) ||
      "The server rejected this attendance record",
    response,
  };
};

/**
 * Sends one queued row.
 *
 * Throws on transport failure so the caller can classify it as retryable —
 * a resolved value always means the server had an opinion.
 *
 * @param {object} row a hydrated `attendance_queue` row
 * @returns {Promise<{result: string, serverCheckinId?: string|null,
 *                    message: string, response: object}>}
 */
export const pushCheckin = async (row) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("Base URL missing");

  const token = await AsyncStorage.getItem("access_token");
  if (!token) throw new Error("Token missing");

  const record = buildCheckinRecord(row);

  if (!record.employee) throw new Error("Queued record has no employee");
  if (!record.timestamp) throw new Error("Queued record has no timestamp");

  const { data } = await apiClient.post(
    `${baseUrl}/api/method/${OFFLINE_CHECKIN_METHOD}`,
    { logs: [record] },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    },
  );

  return interpretPushResponse(data);
};

export default {
  DEVICE_ID,
  OFFLINE_CHECKIN_METHOD,
  PUSH_RESULT,
  buildCheckinRecord,
  interpretPushResponse,
  pushCheckin,
};

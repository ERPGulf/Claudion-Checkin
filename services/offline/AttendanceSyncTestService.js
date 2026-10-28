import { format } from "date-fns";
import { assertCapability, assertCapabilityCurrent } from "../capabilityPolicy";
import { assertEmployeeAutoAttendancePolicy, assertEmployeeAutoAttendancePolicyCurrent } from "../employeeAutoAttendancePolicy";
import { ATTENDANCE_FEATURES } from "../../utils/featureSettings";
import { formatOfflineTimestamp, parseServerWallClock, SERVER_TIMESTAMP_FORMAT } from "../../utils/serverClock";
import { resolveLocationCoordinates } from "../../utils/attendanceLocations";
import { captureAttendanceQueueScope, assertAttendanceQueueScope, normalizeAttendanceTenantKey } from "./attendanceQueueProvenance";
import { readAttendanceConfig } from "./attendanceConfigCache";
import { enqueueSyncTestPair, readSyncTestRange } from "./AttendanceQueueRepository";
import { notifyQueueChanged, requestQueueDrain } from "./AttendanceQueueService";
import { isOfflineQueueingDisallowed, isOfflineSyncUnsupported } from "./offlineCapability";

export const canUseAttendanceSyncTest = () => {
  if (__DEV__) return true;
  try { return require("expo-updates").channel === "preview"; } catch { return false; }
};

let pending = Promise.resolve();
let sequence = 0;
const testError = message => Object.assign(new Error(message), { code: "ATTENDANCE_SYNC_TEST" });

/** Adds historical fixtures only; no live session/native journal is fabricated. */
export const addAttendanceSyncTestPair = async ({ mode, employeeId, tenantKey, isCancelled }) => {
  if (!canUseAttendanceSyncTest()) throw testError("Attendance testing is available in development and preview builds.");
  if (!["chronological", "non-chronological"].includes(mode)) throw testError("Choose an attendance test order.");
  const scope = { ...await captureAttendanceQueueScope(employeeId), isCancelled };
  if (scope.tenantKey !== normalizeAttendanceTenantKey(tenantKey)) throw testError("Your account changed. Please try again.");
  const task = pending.catch(() => {}).then(async () => {
    const context = { baseUrl: scope.tenantKey, employeeCode: scope.employeeId, generation: scope.generation };
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, context);
    await assertCapability(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE, context);
    await assertEmployeeAutoAttendancePolicy(scope);
    if (isOfflineQueueingDisallowed() || isOfflineSyncUnsupported()) throw testError("Offline attendance is not available for this account.");
    const config = await readAttendanceConfig();
    await assertAttendanceQueueScope(scope);
    if (config?.tenantKey !== scope.tenantKey || config?.employeeId !== scope.employeeId) {
      throw testError("Refresh your attendance settings before adding test records.");
    }
    const now = Date.now();
    const serverNow = parseServerWallClock(await formatOfflineTimestamp(now, { tenantKey: scope.tenantKey })).getTime();
    const range = await readSyncTestRange(scope);
    const gap = (30 + Math.floor(Math.random() * 271)) * 1000;
    const duration = (60 + Math.floor(Math.random() * 841)) * 1000;
    const initial = serverNow - 7 * 24 * 60 * 60 * 1000;
    const earlier = mode === "non-chronological";
    const edge = parseServerWallClock(earlier ? range?.earliest : range?.latest)?.getTime();
    const checkinAt = earlier ? (edge ?? initial) - gap - duration : (edge ?? initial) + gap;
    const checkoutAt = checkinAt + duration;
    if (checkoutAt >= serverNow - 60000) throw testError("No more past time slots are available. Add a non-chronological pair instead.");
    const batchId = `sync-test:${now}:${++sequence}:${Math.random().toString(36).slice(2)}`;
    const office = config.locations?.find(location => resolveLocationCoordinates(location));
    const coords = office ? resolveLocationCoordinates(office) : null;
    if (config.rules?.restrictLocation === 1 && !coords) throw testError("Your reporting location is unavailable. Refresh attendance settings.");
    const checkinTime = format(new Date(checkinAt), SERVER_TIMESTAMP_FORMAT);
    const checkoutTime = format(new Date(checkoutAt), SERVER_TIMESTAMP_FORMAT);
    await assertAttendanceQueueScope(scope);
    const rows = await enqueueSyncTestPair({ ...scope, employeeDocname: config.employeeDocname,
      checkinTime, checkoutTime, reverse: earlier, sessionId: batchId,
      location: coords ? { ...coords, name: office.location || "Test attendance" } : null,
      payload: { over_time: 0, location: office?.location || "Test attendance", syncTest: { batchId, mode } },
      assertCurrent: () => {
        if (!canUseAttendanceSyncTest()) throw testError("Attendance testing is unavailable in this build.");
        assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
        assertCapabilityCurrent(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE, scope);
        assertEmployeeAutoAttendancePolicyCurrent(scope);
        if (isOfflineQueueingDisallowed() || isOfflineSyncUnsupported()) throw testError("Offline attendance is unavailable.");
      }, now,
    });
    notifyQueueChanged();
    await assertAttendanceQueueScope(scope);
    requestQueueDrain({ employeeId: scope.employeeId, reason: "test-attendance-added" });
    return { scope, rows, checkinTime, checkoutTime, mode };
  });
  pending = task.catch(() => {});
  return task;
};

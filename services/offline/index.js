// src/services/offline/index.js
//
// Offline attendance: a durable local queue for check-ins and check-outs, a
// cached copy of the rules needed to validate them, and the sync that drains one
// against the server.
//
// The entry point almost everything uses is `submitAttendance` (and its
// `submitManualAttendance` / `submitAutoAttendance` bindings) — it wraps an
// existing online call and falls back to the queue, returning the same contract
// `performSessionTransition` already expects.

export * from "./AttendanceApi";
export * from "./AttendanceDatabase";
export * from "./AttendanceQueueRepository";
export * from "./AttendanceQueueService";
export * from "./AttendanceSyncService";
export * from "./BackgroundSyncManager";
export * from "./NetworkListener";
export * from "./attendanceConfigCache";
export * from "./attendanceErrors";
export * from "./attendancePhotoUpload";
export * from "./offlineAttendanceGate";

import AttendanceApi from "./AttendanceApi";
import AttendanceDatabase from "./AttendanceDatabase";
import AttendanceQueueRepository from "./AttendanceQueueRepository";
import AttendanceQueueService from "./AttendanceQueueService";
import AttendanceSyncService from "./AttendanceSyncService";
import BackgroundSyncManager from "./BackgroundSyncManager";
import NetworkListener from "./NetworkListener";
import attendanceConfigCache from "./attendanceConfigCache";
import attendanceErrors from "./attendanceErrors";
import offlineAttendanceGate from "./offlineAttendanceGate";

export default {
  api: AttendanceApi,
  background: BackgroundSyncManager,
  config: attendanceConfigCache,
  database: AttendanceDatabase,
  errors: attendanceErrors,
  gate: offlineAttendanceGate,
  network: NetworkListener,
  queue: AttendanceQueueService,
  repository: AttendanceQueueRepository,
  sync: AttendanceSyncService,
};

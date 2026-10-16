/**
 * @jest-environment jsdom
 *
 * M0 current-behaviour characterization; source reference: de722c9.
 * See docs/auto-attendance-sdk/08-M0-VALIDATION.md and 09-SDK-DECISIONS.md.
 *
 * Queue/schema/provenance/gate/session/online API/bulk API/sync are production
 * implementations. Only HTTP, connectivity and native SQLite/location seams
 * are substituted. SQLite uses the existing sql.js-backed test helper.
 * A native-shaped last event is input at the JS replay boundary, not proof of
 * native capture or process-death durability. Shared logout cleanup is tested
 * directly; Profile UI and apiClient's 401 interceptor are not mounted here.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../services/api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("../services/offline/NetworkListener", () => ({
  __esModule: true,
  fetchShouldAttemptRequest: jest.fn(),
  isOnline: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/api/apiClient";
import { autoCheckInOut } from "../services/api/attendance.service";
import {
  QUEUE_ACTION,
  QUEUE_STATUS,
  resetDatabaseHandle,
  getDatabase,
} from "../services/offline/AttendanceDatabase";
import {
  claimNextPending,
  listAll,
} from "../services/offline/AttendanceQueueRepository";
import {
  clearOfflineAttendance,
  getQueueCounts,
  registerQueueDrainHandler,
  submitAutoAttendance,
} from "../services/offline/AttendanceQueueService";
import {
  resetSyncService,
  syncPendingAttendance,
} from "../services/offline/AttendanceSyncService";
import {
  ATTENDANCE_SCOPE_CHANGED,
  assertAttendanceQueueScope,
  captureAttendanceQueueScope,
} from "../services/offline/attendanceQueueProvenance";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import {
  fetchShouldAttemptRequest,
  isOnline,
} from "../services/offline/NetworkListener";
import { invalidateAuthSession } from "../utils/authSessionGuard";
import {
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";
import { evaluatePendingEvent, PENDING_EVENT } from "../utils/geofenceEventLog";
import { resetServerClockCache } from "../utils/serverClock";
import { loginQueueEmployee } from "../test-utils/attendanceScope";

const { __resetAll } = require("../test-utils/expoSqliteMock");

const TENANT_A = "https://m0-company-a.example.com";
const TENANT_B = "https://m0-company-b.example.com";
const EMPLOYEE_A = "M0-EMPLOYEE-A";
const EMPLOYEE_B = "M0-EMPLOYEE-B";
const TOKEN = "synthetic-m0-access-token";
// Local components match the application's naive timestamp formatter in every TZ.
const at = (hour, minute = 0, millisecond = 0) =>
  new Date(2026, 9, 9, hour, minute, 0, millisecond).getTime();
const NOW = at(12);
const ONLINE_METHOD =
  "employee_app.attendance_api.add_log_based_on_employee_field";
const BULK_METHOD = "employee_app.attendance_api.add_offline_employee_checkins";

const accepted = (name = "M0-SYNTHETIC-CHECKIN") => ({
  data: { message: { inserted: [name], failed: [] } },
});

const networkFailure = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });

const cacheConfig = async (employeeId = EMPLOYEE_A, tenantKey = TENANT_A) => {
  await AsyncStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      employeeId,
      employeeDocname: employeeId,
      tenantKey,
      locations: [],
      rules: {
        restrictLocation: 1,
        unrestrictedCheckoutLocation: 0,
        photo: 0,
        geotagging: 2,
      },
      lastUpdated: NOW,
    }),
  );
};

const login = async (
  employeeId = EMPLOYEE_A,
  tenantKey = TENANT_A,
  token = TOKEN,
) => {
  await loginQueueEmployee(employeeId, tenantKey, token);
  await cacheConfig(employeeId, tenantKey);
};

// No sourceScope is invented for a historical native event. The bootstrap
// passes null when occurredAt predates the scope it observed at launch.
const submit = ({
  type = "IN",
  occurredAt = at(8),
  employeeCode = EMPLOYEE_A,
  ...options
} = {}) =>
  submitAutoAttendance({
    type,
    employeeCode,
    occurredAt,
    online: () => autoCheckInOut({ employeeCode, type, occurredAt }),
    ...options,
  });

const bulkCalls = () =>
  apiClient.post.mock.calls.filter(([url]) => url.endsWith(BULK_METHOD));

beforeEach(async () => {
  jest.clearAllMocks();
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  resetServerClockCache();
  resetOfflineCapability();
  registerQueueDrainHandler(null);
  await AsyncStorage.clear();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  fetchShouldAttemptRequest.mockResolvedValue(false);
  isOnline.mockReturnValue(false);
  apiClient.get.mockResolvedValue({
    data: { message: { server_time: "2026-10-09 12:00:00" } },
  });
  apiClient.post.mockRejectedValue(networkFailure());
  await login();
});

afterEach(() => {
  registerQueueDrainHandler(null);
  resetSyncService();
  jest.restoreAllMocks();
  __resetAll();
  resetDatabaseHandle();
});

describe("M0 current behaviour: replay attribution and the NULL-tenant stall (A)", () => {
  it("characterizes current behaviour: a failed historical replay queues without tenant and blocks a younger scoped punch [M0-A1]", async () => {
    const pending = evaluatePendingEvent({
      lastEvent: {
        identifier: "office-main",
        transition: "ENTER",
        timestamp: at(8),
      },
      lastProcessedAt: null,
      nowMs: NOW,
    });
    expect(pending.status).toBe(PENDING_EVENT.READY);
    fetchShouldAttemptRequest.mockResolvedValue(true);

    // Real online API fails; real cached-policy gate and queue preserve the punch.
    const replay = await submit({
      type: pending.type,
      occurredAt: pending.occurredAt,
    });
    expect(replay).toMatchObject({ allowed: true, queued: true });
    expect(replay.row).toMatchObject({
      employeeId: EMPLOYEE_A,
      tenantKey: null,
      timestamp: "2026-10-09 08:00:00",
    });
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({
      auto: true,
      log_type: "IN",
    });
    expect(
      await claimNextPending(NOW, {
        employeeId: EMPLOYEE_A,
        tenantKey: TENANT_A,
      }),
    ).toBeNull();

    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const younger = await submit({ occurredAt: at(9), sourceScope });
    expect(younger.row.tenantKey).toBe(TENANT_A);
    expect(
      await claimNextPending(NOW, {
        employeeId: EMPLOYEE_A,
        tenantKey: TENANT_A,
      }),
    ).toBeNull();

    apiClient.post.mockResolvedValue(accepted());
    const drain = await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(drain.synced).toBe(0);
    expect(bulkCalls()).toHaveLength(0);
    const rows = await listAll();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === replay.row.id)).toMatchObject({
      tenantKey: null,
      status: QUEUE_STATUS.PENDING,
    });
    expect(rows.find((row) => row.id === younger.row.id)).toMatchObject({
      tenantKey: TENANT_A,
      status: QUEUE_STATUS.PENDING,
    });
    expect((await getQueueCounts(EMPLOYEE_A)).mayAffectServerCount).toBe(2);
  });

  it("characterizes current behaviour: an explicit valid originating scope retains tenant on an old timestamp [M0-A2]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const result = await submit({ sourceScope });
    expect(result.row).toMatchObject({
      employeeId: EMPLOYEE_A,
      tenantKey: TENANT_A,
    });
    const claimed = await claimNextPending(NOW, {
      employeeId: EMPLOYEE_A,
      tenantKey: TENANT_A,
    });
    expect(claimed.id).toBe(result.row.id);
  });

  it("characterizes current behaviour: a later online EXIT bypasses the pending NULL-tenant IN and closes the local session [M0-A3]", async () => {
    const checkin = await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      at: at(8),
      execute: () => submit(),
    });
    expect(checkin.queued).toBe(true);
    expect((await listAll())[0].tenantKey).toBeNull();

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue({
      data: { message: { name: "M0-ONLINE-OUT" } },
    });
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    // Bootstrap's forceQueue rule applies to IN only, so live OUT has false.
    const checkout = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      at: at(9),
      execute: () =>
        submit({
          type: "OUT",
          occurredAt: at(9),
          sourceScope,
          forceQueue: false,
        }),
    });
    expect(checkout).toMatchObject({
      status: TRANSITION_RESULT.COMPLETED,
      queued: false,
      serverConfirmed: true,
    });
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post.mock.calls[0][0]).toBe(
      `${TENANT_A}/api/method/${ONLINE_METHOD}`,
    );
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({
      log_type: "OUT",
      auto: true,
    });
    expect((await listAll())[0]).toMatchObject({
      tenantKey: null,
      status: QUEUE_STATUS.PENDING,
    });
  });
});

describe("M0 current behaviour: automatic metadata across delivery paths (D)", () => {
  it("characterizes current behaviour: actual online payload has auto:true but queued bulk upload omits auto [M0-D1]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValueOnce({
      data: { message: { name: "M0-ONLINE-IN" } },
    });
    const online = await submit({ sourceScope });
    expect(online).toMatchObject({ allowed: true, name: "M0-ONLINE-IN" });
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({
      auto: true,
      log_type: "IN",
    });

    fetchShouldAttemptRequest.mockResolvedValue(false);
    const queued = await submit({ occurredAt: at(9), sourceScope });
    expect(queued.row.attendanceType).toBe("auto");
    expect(queued.row.payload).not.toHaveProperty("auto");
    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(1);

    const [[url, body]] = bulkCalls();
    expect(url).toBe(`${TENANT_A}/api/method/${BULK_METHOD}`);
    expect(body.logs).toEqual([
      {
        employee: EMPLOYEE_A,
        timestamp: "2026-10-09 09:00:00",
        device_id: "MobileAPP",
        log_type: "IN",
        over_time: 0,
      },
    ]);
    expect(body.logs[0]).not.toHaveProperty("auto");
  });
});

describe("M0 current behaviour: logout cleanup and queue scope changes (E)", () => {
  it.each(["explicit logout", "token expiry"])(
    "characterizes current behaviour: shared %s cleanup retains scoped rows but prevents unauthenticated delivery [M0-E1]",
    async () => {
      const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
      const queued = await submit({ sourceScope });

      // Shared attendance cleanup called by Profile and App's expiry hook.
      // Auth invalidation/removals mirror those callers; no fake queue cleanup.
      invalidateAuthSession();
      await clearOfflineAttendance();
      await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
      expect(await AsyncStorage.getItem(CONFIG_KEY)).toBeNull();
      expect((await listAll())[0]).toMatchObject({
        id: queued.row.id,
        employeeId: EMPLOYEE_A,
        tenantKey: TENANT_A,
        status: QUEUE_STATUS.PENDING,
      });
      fetchShouldAttemptRequest.mockResolvedValue(true);
      expect(
        await syncPendingAttendance({ employeeId: EMPLOYEE_A }),
      ).toMatchObject({
        ran: false,
        reason: "scope-changed",
      });
      expect(apiClient.post).not.toHaveBeenCalled();

      const recoveredToken = "synthetic-m0-recovery-token";
      await login(EMPLOYEE_A, TENANT_A, recoveredToken);
      apiClient.post.mockResolvedValue(accepted());
      expect(
        (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
      ).toBe(1);
      expect(bulkCalls()[0][2].headers.Authorization).toBe(
        `Bearer ${recoveredToken}`,
      );
    },
  );

  it("characterizes current behaviour: another employee drains only their own rows while the previous employee's rows remain [M0-E2]", async () => {
    const scopeA = await captureAttendanceQueueScope(EMPLOYEE_A);
    const rowA = (await submit({ sourceScope: scopeA })).row;
    await clearOfflineAttendance();
    await login(EMPLOYEE_B);
    const scopeB = await captureAttendanceQueueScope(EMPLOYEE_B);
    const rowB = (
      await submit({
        employeeCode: EMPLOYEE_B,
        occurredAt: at(9),
        sourceScope: scopeB,
      })
    ).row;

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_B })).synced,
    ).toBe(1);
    expect(bulkCalls().map(([, body]) => body.logs[0].employee)).toEqual([
      EMPLOYEE_B,
    ]);
    const rows = await listAll();
    expect(rows.find((row) => row.id === rowA.id).status).toBe(
      QUEUE_STATUS.PENDING,
    );
    expect(rows.find((row) => row.id === rowB.id).status).toBe(
      QUEUE_STATUS.SYNCED,
    );
    await expect(assertAttendanceQueueScope(scopeA)).rejects.toMatchObject({
      code: ATTENDANCE_SCOPE_CHANGED,
    });
  });

  it("characterizes current behaviour: the same employee code on another tenant cannot upload the former tenant's attributable row [M0-E3]", async () => {
    const scopeA = await captureAttendanceQueueScope(EMPLOYEE_A);
    const rowA = (await submit({ sourceScope: scopeA })).row;
    await clearOfflineAttendance();
    await login(EMPLOYEE_A, TENANT_B);
    const scopeB = await captureAttendanceQueueScope(EMPLOYEE_A);
    const rowB = (await submit({ occurredAt: at(9), sourceScope: scopeB })).row;

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(1);
    expect(bulkCalls()).toHaveLength(1);
    expect(bulkCalls()[0][0]).toBe(`${TENANT_B}/api/method/${BULK_METHOD}`);
    const rows = await listAll();
    expect(rows.find((row) => row.id === rowA.id)).toMatchObject({
      tenantKey: TENANT_A,
      status: QUEUE_STATUS.PENDING,
    });
    expect(rows.find((row) => row.id === rowB.id)).toMatchObject({
      tenantKey: TENANT_B,
      status: QUEUE_STATUS.SYNCED,
    });
  });

  it("refuses stale captured auth scope after same-account reauthentication while preserving accepted rows [M0-E4]", async () => {
    const oldScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const acceptedBeforeReauthentication = (await submit({ sourceScope: oldScope, occurredAt: at(7) })).row;
    invalidateAuthSession();
    await clearOfflineAttendance();
    await login();
    const result = await submit({ sourceScope: oldScope });
    expect(result).toMatchObject({ allowed: false, reason: "scope-changed" });
    expect(await listAll()).toEqual([acceptedBeforeReauthentication]);
    await expect(assertAttendanceQueueScope(oldScope)).rejects.toMatchObject({
      code: ATTENDANCE_SCOPE_CHANGED,
    });

    const currentScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const current = await submit({ sourceScope: currentScope });
    expect(current).toMatchObject({ allowed: true, queued: true, row: {
      employeeId: EMPLOYEE_A, tenantKey: TENANT_A,
    } });
    expect(await listAll()).toHaveLength(2);
  });
});

describe("M0 current behaviour: queue ordering and duplicate protection (G)", () => {
  it("characterizes current behaviour: offline ENTER then EXIT closes locally, pairs rows, and uploads IN before OUT one record per request [M0-G1]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const enter = await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      at: at(8),
      execute: () => submit({ sourceScope }),
    });
    const exit = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      at: at(9),
      execute: () => submit({ type: "OUT", occurredAt: at(9), sourceScope }),
    });
    expect(enter.queued).toBe(true);
    expect(exit.queued).toBe(true);
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    // listAll is a support view (newest id first), not the drain's FIFO query.
    const before = (await listAll()).sort((a, b) => a.id - b.id);
    expect(before.map((row) => row.action)).toEqual([
      QUEUE_ACTION.CHECKIN,
      QUEUE_ACTION.CHECKOUT,
    ]);
    expect(before[1].pairedAttendanceId).toBe(before[0].id);

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(2);
    expect(
      bulkCalls().map(([, body]) => body.logs.map((record) => record.log_type)),
    ).toEqual([["IN"], ["OUT"]]);
    expect(bulkCalls().map(([, body]) => body.logs[0].timestamp)).toEqual([
      "2026-10-09 08:00:00",
      "2026-10-09 09:00:00",
    ]);
    expect(
      (await listAll()).every((row) => row.status === QUEUE_STATUS.SYNCED),
    ).toBe(true);
  });

  it("characterizes current behaviour: same-second duplicate submissions are collapsed by the SQLite identity/time/action index [M0-G2]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const first = await submit({ sourceScope });
    const duplicate = await submit({ occurredAt: at(8, 0, 500), sourceScope });
    expect(first.alreadyQueued).toBe(false);
    expect(duplicate.alreadyQueued).toBe(true);
    expect(duplicate.row.id).toBe(first.row.id);
    expect(await listAll()).toHaveLength(1);

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(1);
    await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(bulkCalls()).toHaveLength(1);
  });

  it("characterizes current behaviour: a server duplicate with exact matching history resolves the row and does not upload it again [M0-G3]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    await submit({ sourceScope });
    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue({
      data: {
        message: {
          inserted: [],
          failed: [
            {
              error: "This employee already has a log with the same timestamp.",
            },
          ],
        },
      },
    });
    // The actual verifier needs positive employee/type/timestamp/name evidence;
    // the original sync unit suite substitutes an always-verified helper.
    apiClient.get.mockResolvedValue({
      data: {
        message: [
          {
            name: "M0-VERIFIED-DUPLICATE",
            employee: EMPLOYEE_A,
            time: "2026-10-09 08:00:00",
            log_type: "IN",
          },
        ],
      },
    });
    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(summary.duplicates).toBe(1);
    expect((await listAll())[0]).toMatchObject({
      status: QUEUE_STATUS.SYNCED,
      duplicate: true,
    });
    await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(bulkCalls()).toHaveLength(1);
  });

  it("characterizes current behaviour: a duplicate without exact matching server history needs review and is not automatically resent [M0-G7]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    await submit({ sourceScope });
    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue({
      data: {
        message: {
          inserted: [],
          failed: [
            {
              error: "This employee already has a log with the same timestamp.",
            },
          ],
        },
      },
    });
    apiClient.get.mockResolvedValue({ data: { message: [] } });
    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(summary.duplicates).toBe(0);
    expect(summary.needsReview).toBe(1);
    expect((await listAll())[0]).toMatchObject({
      status: QUEUE_STATUS.NEEDS_REVIEW,
      duplicate: true,
    });
    await syncPendingAttendance({ employeeId: EMPLOYEE_A });
    expect(bulkCalls()).toHaveLength(1);
  });

  it("characterizes current behaviour: queue-only out-of-order arrival drains by timestamp but does not retroactively pair an earlier-enqueued EXIT [M0-G4]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    // Direct queue boundary deliberately bypasses the session machine: this
    // isolates SQL ordering rather than claiming bootstrap permits this order.
    const exit = await submit({ type: "OUT", occurredAt: at(10), sourceScope });
    const enter = await submit({ occurredAt: at(8), sourceScope });
    expect(exit.row.pairedAttendanceId).toBeNull();
    expect(exit.row.id).toBeLessThan(enter.row.id);

    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(2);
    expect(bulkCalls().map(([, body]) => body.logs[0].log_type)).toEqual([
      "IN",
      "OUT",
    ]);
    expect(
      (await listAll()).find((row) => row.id === exit.row.id)
        .pairedAttendanceId,
    ).toBeNull();
  });

  it("recovers an expired scoped claim with no dispatched upload after handle recreation [M0-G5]", async () => {
    const sourceScope = await captureAttendanceQueueScope(EMPLOYEE_A);
    const queued = await submit({ sourceScope });
    const claimed = await claimNextPending(NOW, {
      employeeId: EMPLOYEE_A,
      tenantKey: TENANT_A,
    });
    expect(claimed.id).toBe(queued.row.id);
    expect(claimed.status).toBe(QUEUE_STATUS.SYNCING);
    // A newly recreated runtime cannot revoke a live owner's claim. Simulate
    // an expired pre-dispatch owner, where replay has durable proof of no POST.
    await (await getDatabase()).runAsync("UPDATE attendance_queue SET claimExpiresAt = ? WHERE id = ?;", [NOW - 1, claimed.id]);
    // Existing sql.js connection survives handle recreation. This proves JS
    // recovery logic, not persistence through actual OS process termination.
    resetDatabaseHandle();
    resetSyncService();
    fetchShouldAttemptRequest.mockResolvedValue(true);
    apiClient.post.mockResolvedValue(accepted());
    expect(
      (await syncPendingAttendance({ employeeId: EMPLOYEE_A })).synced,
    ).toBe(1);
    expect((await listAll())[0].status).toBe(QUEUE_STATUS.SYNCED);
  });

  it("characterizes current behaviour: identical employee/time/action values remain separate rows for two known tenants [M0-G6]", async () => {
    const scopeA = await captureAttendanceQueueScope(EMPLOYEE_A);
    const first = await submit({ sourceScope: scopeA });
    await login(EMPLOYEE_A, TENANT_B);
    const scopeB = await captureAttendanceQueueScope(EMPLOYEE_A);
    const second = await submit({ sourceScope: scopeB });
    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(false);
    expect(first.row.id).not.toBe(second.row.id);
    expect((await listAll()).map((row) => row.tenantKey)).toEqual([
      TENANT_B,
      TENANT_A,
    ]);
  });
});

describe("future SDK desired-behaviour specifications (not implemented or counted as passing)", () => {
  test.todo(
    "[M0-A1; decision 1/7/8] capture-time tenant/employee scope survives native replay; unattributed legacy rows are quarantined without blocking attributable rows",
  );
  test.todo(
    "[M0-A3; decision 5/14] host transport defines ordering across direct online delivery and pending outbox records",
  );
  test.todo(
    "[M0-D1; decision 14] validated backend adapter preserves automatic origin on online and offline payloads without an unapproved source endpoint change",
  );
  test.todo(
    "[M0-E4; decision 7/12] captured identity remains immutable across auth generations and old scopes cannot receive a new account's credentials",
  );
  test.todo(
    "[M0-G2; decision 2/5] stable event IDs distinguish actual captures and deduplicate replay independently of second-resolution attendance timestamps",
  );
});

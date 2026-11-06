/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { countByStatus, enqueue, listForHistory, listRecoveryRows, listUnresolved, markBlocked } from "../services/offline/AttendanceQueueRepository";
import { getHistoryRows, getQueueCounts, getUnresolvedRows } from "../services/offline/AttendanceQueueService";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from "../utils/authSessionGuard";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const current = { employeeId: "0007", tenantKey: "https://company-a.example" };
const foreign = "https://company-b.example";
const seed = overrides => enqueue({ ...current, attendanceType: "auto", action: "checkin",
  timestamp: "2026-11-04 09:00:00", now: 10000, ...overrides });

beforeEach(async () => {
  __resetAll();
  resetDatabaseHandle();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([["baseUrl", current.tenantKey], ["employee_code", current.employeeId],
    ["access_token", "synthetic-access"], ["api_key", "synthetic-account"]]);
});

it("isolates same-code known tenants in history, unresolved rows and every derived count", async () => {
  const own = (await seed()).row;
  await seed({ tenantKey: foreign, now: 1 });
  const ownBlocked = (await seed({ timestamp: "2026-11-04 09:01:00" })).row;
  await markBlocked({ id: ownBlocked.id, failureClass: "auth" });
  const otherBlocked = (await seed({ tenantKey: foreign, timestamp: "2026-11-04 09:01:00" })).row;
  await markBlocked({ id: otherBlocked.id, failureClass: "endpoint-missing" });
  const scope = await captureAttendanceQueueScope(current.employeeId);
  expect((await getHistoryRows(current.employeeId, scope)).map(row => row.id).sort()).toEqual([own.id, ownBlocked.id]);
  expect((await getUnresolvedRows(current.employeeId, scope)).map(row => row.id).sort()).toEqual([own.id, ownBlocked.id]);
  expect(await getQueueCounts(current.employeeId, scope)).toMatchObject({ total: 2,
    pendingCount: 1, blockedCount: 1, blockedUndeliverableCount: 0,
    awaitingServerCount: 2, mayAffectServerCount: 2, oldestPendingAt: 10000 });
});

it("retains unknown-provenance evidence and conservative dependencies without assigning it a tenant", async () => {
  const unknown = (await seed({ tenantKey: null, now: 5000 })).row;
  await seed({ tenantKey: foreign, now: 1 });
  const scope = await captureAttendanceQueueScope(current.employeeId);
  expect(await getHistoryRows(current.employeeId, scope)).toEqual([expect.objectContaining({ id: unknown.id, tenantKey: null })]);
  expect(await getUnresolvedRows(current.employeeId, scope)).toEqual([expect.objectContaining({ id: unknown.id, tenantKey: null })]);
  expect(await getQueueCounts(current.employeeId, scope)).toMatchObject({ pendingCount: 1, awaitingServerCount: 1, oldestPendingAt: 5000 });
  expect(await listRecoveryRows(scope)).toEqual([expect.objectContaining({ id: unknown.id, tenantKey: null })]);
});

it("keeps unscoped repository inspection compatible and makes exact tenant reads opt-in", async () => {
  await seed();
  await seed({ tenantKey: foreign });
  await seed({ tenantKey: null });
  expect((await countByStatus(current.employeeId)).total).toBe(3);
  expect(await listForHistory({ employeeId: current.employeeId })).toHaveLength(3);
  expect(await listUnresolved({ employeeId: current.employeeId })).toHaveLength(3);
  expect((await countByStatus(current.employeeId, { tenantKey: current.tenantKey })).total).toBe(1);
});

it("rejects a read whose authentication generation becomes stale during SQLite work", async () => {
  await seed();
  const scope = await captureAttendanceQueueScope(current.employeeId);
  const db = await getDatabase();
  const original = db.getAllAsync;
  db.getAllAsync = async (...args) => {
    db.getAllAsync = original;
    const rows = await original(...args);
    invalidateAuthSession();
    return rows;
  };
  await expect(getHistoryRows(current.employeeId, scope)).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
});

it("refuses an employee mismatch before returning another account's rows", async () => {
  const scope = await captureAttendanceQueueScope(current.employeeId);
  await expect(getQueueCounts("another-employee", scope)).rejects.toThrow("scope changed");
});

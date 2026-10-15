import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHECKIN_START_TIME_KEY, LAST_CHECKOUT_TIME_KEY } from "../utils/attendanceSession";
import {
  applySessionOwner, clearSessionState, clearUnverifiedSessionOwner,
  performSessionTransition, readSession, readUnverifiedSessionOwner,
  reconcileSessionFromServer,
  SESSION_ORIGIN, SESSION_OWNER_KEY, SESSION_STATE_KEY, TRANSITION_RESULT,
} from "../utils/attendanceSessionState";

const tenantA = "https://attendance.example.com";
const tenantB = "https://other.example.com";
const employeeId = "EMP-001";
const startedAt = 1791800000000;
const ok = async () => ({ allowed: true, name: "CHECKIN-1" });
const checkIn = () => performSessionTransition({
  type: "IN", origin: SESSION_ORIGIN.MANUAL, at: startedAt, execute: ok,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

it("restores the native source parent from storage and clears it on the next manual IN", async () => {
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt,
    sourceEventId: "native-enter", execute: ok });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: "native-enter" });
  const execute = jest.fn(ok);
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: startedAt + 1000,
    withSessionContext: true, execute });
  expect(execute.mock.calls[0][0].sourceEventId).toBe("native-enter");
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.MANUAL, at: startedAt + 2000, execute: ok });
  expect((await readSession()).sourceEventId).toBeUndefined();
});

it("keeps the source parent when server reconciliation describes the same session", async () => {
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt,
    sourceEventId: "native-enter", execute: ok });
  expect(await reconcileSessionFromServer({ activeStartedAt: startedAt, fetchedAt: startedAt + 1000 }))
    .toMatchObject({ sourceEventId: "native-enter" });
  expect((await reconcileSessionFromServer({ activeStartedAt: startedAt + 2000, fetchedAt: Date.now() + 3000 })).sourceEventId)
    .toBeUndefined();
});

it("does not manufacture a closed session from corrupt storage during automatic processing", async () => {
  await AsyncStorage.setItem(SESSION_STATE_KEY, "{corrupt-record");
  const execute = jest.fn(ok);
  await expect(performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt,
    strictRead: true, execute })).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBe("{corrupt-record");
});

it("clears a same-code session when its verified tenant changes, retaining no foreign checkout floor", async () => {
  await applySessionOwner(employeeId, { tenantKey: tenantA });
  await checkIn();
  await AsyncStorage.setItem(LAST_CHECKOUT_TIME_KEY, String(startedAt - 1000));
  expect(await applySessionOwner(employeeId, { tenantKey: tenantB })).toBe(true);
  expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY)).toBeNull();
  expect(JSON.parse(await AsyncStorage.getItem(SESSION_OWNER_KEY))).toEqual({ employeeId, tenantKey: tenantB });
});

it("preserves a same-tenant employee's open manual session across reauthentication", async () => {
  await applySessionOwner(employeeId, { tenantKey: tenantA });
  await checkIn();
  expect(await applySessionOwner(employeeId, { tenantKey: tenantA })).toBe(false);
  expect((await readSession()).startedAt).toBe(startedAt);
});

it("saves unverified legacy ownership evidence before migrating an open session", async () => {
  await AsyncStorage.setItem(SESSION_OWNER_KEY, employeeId);
  await checkIn();
  await AsyncStorage.setItem(LAST_CHECKOUT_TIME_KEY, String(startedAt - 1000));
  expect(await applySessionOwner(employeeId, { tenantKey: tenantA })).toBe(true);
  expect(await readUnverifiedSessionOwner()).toMatchObject({
    previousOwner: { employeeId, tenantKey: null },
    intendedOwner: { employeeId, tenantKey: tenantA },
    session: { status: "CHECKED_IN", origin: "MANUAL", startedAt },
    checkinStartTime: startedAt, lastCheckoutTime: startedAt - 1000,
  });
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect(await AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY)).toBeNull();
  await clearUnverifiedSessionOwner();
  expect(await readUnverifiedSessionOwner()).toBeNull();
});

it("preserves no-owner legacy active evidence without inventing a tenant", async () => {
  await checkIn();
  await applySessionOwner(employeeId, { tenantKey: tenantA });
  expect(await readUnverifiedSessionOwner()).toMatchObject({ previousOwner: null, session: { startedAt } });
});

it("archives an unscoped closed session's checkout floor before scoped reconciliation", async () => {
  await AsyncStorage.setItem(SESSION_OWNER_KEY, employeeId);
  await checkIn();
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: startedAt + 1000, execute: ok });
  await applySessionOwner(employeeId, { tenantKey: tenantA });
  expect(await readUnverifiedSessionOwner()).toMatchObject({
    intendedOwner: { employeeId, tenantKey: tenantA },
    session: { status: "CHECKED_OUT", endedAt: startedAt + 1000 },
    lastCheckoutTime: startedAt + 1000,
  });
  expect(await AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY)).toBeNull();
});

it("does not clear an active legacy session if saving migration evidence fails", async () => {
  await checkIn();
  const set = AsyncStorage.setItem.getMockImplementation();
  AsyncStorage.setItem.mockImplementation((key, value) => {
    if (key === "attendanceSessionUnverifiedOwner") return Promise.reject(new Error("Storage unavailable"));
    return set(key, value);
  });
  try {
    await expect(applySessionOwner(employeeId, { tenantKey: tenantA })).rejects.toThrow("Storage unavailable");
    expect((await readSession()).status).toBe("CHECKED_IN");
    expect(await AsyncStorage.getItem(SESSION_OWNER_KEY)).toBeNull();
  } finally {
    AsyncStorage.setItem.mockImplementation(set);
  }
});

it("serializes ownership changes after an in-flight session transition", async () => {
  await applySessionOwner(employeeId, { tenantKey: tenantA });
  let release, signal;
  const started = new Promise(resolve => { signal = resolve; });
  const transition = performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt,
    execute: () => { signal(); return new Promise(resolve => { release = resolve; }); } });
  await started;
  const ownerChange = applySessionOwner("EMP-OTHER", { tenantKey: tenantA });
  release({ allowed: true, queued: true });
  await transition;
  expect(await ownerChange).toBe(true);
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("serializes explicit session clearing rather than allowing a late commit to resurrect it", async () => {
  let release, signal;
  const started = new Promise(resolve => { signal = resolve; });
  const transition = performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt,
    execute: () => { signal(); return new Promise(resolve => { release = resolve; }); } });
  await started;
  const clearing = clearSessionState();
  release({ allowed: true });
  await Promise.all([transition, clearing]);
  expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBeNull();
});

it("does not dispatch an old native event when account validation fails before execute", async () => {
  const execute = jest.fn(ok);
  const assertCurrent = jest.fn(async () => { throw new Error("Account changed"); });
  await expect(performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, execute, assertCurrent })).rejects.toThrow("Account changed");
  expect(execute).not.toHaveBeenCalled();
});

it("does not commit an accepted old-scope response into a changed account", async () => {
  let current = true;
  const assertCurrent = async () => { if (!current) throw new Error("Account changed"); };
  await expect(performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt, assertCurrent,
    execute: async () => { current = false; return { allowed: true }; } })).rejects.toThrow("Account changed");
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("rejects a delayed EXIT older than the manually opened session", async () => {
  await checkIn();
  const execute = jest.fn(ok);
  const result = await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.AUTO, at: startedAt - 1000, rejectStale: true, execute });
  expect(result).toMatchObject({ status: TRANSITION_RESULT.SKIPPED, reason: "stale-event" });
  expect(execute).not.toHaveBeenCalled();
  expect((await readSession()).status).toBe("CHECKED_IN");
});

it("rejects an old ENTER preceding an already committed manual checkout", async () => {
  await checkIn();
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: startedAt + 10000, execute: ok });
  const execute = jest.fn(ok);
  const result = await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt + 5000, rejectStale: true, execute });
  expect(result.reason).toBe("stale-event");
  expect(execute).not.toHaveBeenCalled();
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("preserves manual IN -> auto EXIT and auto IN -> manual OUT semantics with freshness enabled", async () => {
  await checkIn();
  expect((await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.AUTO, at: startedAt + 1000, rejectStale: true, execute: ok })).status).toBe("completed");
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: startedAt + 2000, rejectStale: true, execute: ok });
  expect((await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: startedAt + 3000, execute: ok })).status).toBe("completed");
  expect((await readSession()).closedBy).toBe("MANUAL");
});

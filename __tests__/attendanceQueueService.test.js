/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));

jest.mock("../services/offline/NetworkListener", () => {
  // `fetchShouldAttemptRequest` tracks `fetchIsOnline` by default so the
  // existing "go offline" setup in this suite still means offline. The suites
  // that care about the two DISAGREEING — a network whose captive-portal probe
  // fails, so reachability says no while requests work — override it.
  const fetchIsOnline = jest.fn(() => Promise.resolve(true));
  return {
    __esModule: true,
    fetchIsOnline,
    fetchShouldAttemptRequest: jest.fn(() => fetchIsOnline()),
    isOnline: jest.fn(() => true),
  };
});

jest.mock("../services/offline/offlineAttendanceGate", () => ({
  __esModule: true,
  evaluateOfflineAttendance: jest.fn(),
}));

import {
  QUEUE_STATUS,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import {
  shouldQueueFailure,
  submitAttendance,
  submitAutoAttendance,
  submitManualAttendance,
} from "../services/offline/AttendanceQueueService";
import { fetchIsOnline } from "../services/offline/NetworkListener";
import { evaluateOfflineAttendance } from "../services/offline/offlineAttendanceGate";
import { NO_CONFIG_MESSAGE } from "../services/offline/attendanceConfigCache";
import {
  OFFLINE_DISABLED_MESSAGE,
  OFFLINE_UNSUPPORTED_MESSAGE,
} from "../services/offline/AttendanceQueueService";
import {
  markOfflineSyncUnsupported,
  resetOfflineCapability,
  setOfflineQueueingAllowed,
} from "../services/offline/offlineCapability";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * `submitAttendance` is the one decision the whole feature turns on: run the
 * real call, queue it, or refuse. Getting it wrong either loses a punch or lets
 * aeroplane mode bypass the location policy.
 */
const acceptedGate = {
  allowed: true,
  reason: "within-radius",
  location: { locationName: "Doha HQ", distance: 12, radius: 100 },
  coords: { latitude: 25.28, longitude: 51.52, accuracy: 8 },
  config: { employeeDocname: "HR-EMP-00001" },
};

const networkFailure = () => ({
  allowed: false,
  message: "Network Error",
  error: Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }),
});

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
  jest.clearAllMocks();
  fetchIsOnline.mockResolvedValue(true);
  evaluateOfflineAttendance.mockResolvedValue(acceptedGate);
  resetOfflineCapability();
});

/**
 * A server with no offline endpoint is a property of the deployment, not of a
 * punch. Queueing into it would be a promise the app cannot keep.
 */
describe("when the server has no offline endpoint", () => {
  beforeEach(async () => {
    fetchIsOnline.mockResolvedValue(false);
    await markOfflineSyncUnsupported();
  });

  it("refuses honestly instead of queueing into a hole", async () => {
    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unsupported");
    expect(result.message).toBe(OFFLINE_UNSUPPORTED_MESSAGE);
    expect(await listAll()).toHaveLength(0);
  });

  it("names the constraint without blaming the employee", () => {
    expect(OFFLINE_UNSUPPORTED_MESSAGE).toMatch(/organization's server/i);
    expect(OFFLINE_UNSUPPORTED_MESSAGE).not.toMatch(/fail|error/i);
  });

  it("never refuses the online path — only queueing", async () => {
    fetchIsOnline.mockResolvedValue(true);
    const online = jest.fn().mockResolvedValue({ allowed: true, name: "X" });

    expect(
      (await submitAttendance({ type: "IN", employeeCode: "TDI0167", online }))
        .allowed,
    ).toBe(true);
  });
});

/**
 * The administrator's switch used to stop the sync manager while leaving the
 * punch path queueing, so a tenant with offline attendance switched off wrote
 * rows into a queue that nothing drained: "Pending sync" forever, no attendance
 * in the backend, and no error anywhere to explain it.
 *
 * The switch now governs one thing — whether a punch may be queued.
 */
describe("when the administrator has switched offline attendance off", () => {
  beforeEach(() => {
    fetchIsOnline.mockResolvedValue(false);
    setOfflineQueueingAllowed(false);
  });

  it("refuses rather than queueing into a queue nothing drains", async () => {
    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("admin-disabled");
    expect(result.message).toBe(OFFLINE_DISABLED_MESSAGE);
    expect(await listAll()).toHaveLength(0);
  });

  it("leaves the online path alone", async () => {
    fetchIsOnline.mockResolvedValue(true);
    const online = jest.fn().mockResolvedValue({ allowed: true, name: "X" });

    expect(
      (await submitAttendance({ type: "IN", employeeCode: "TDI0167", online }))
        .allowed,
    ).toBe(true);
  });

  it("queues normally while the server has not said either way", async () => {
    // `utils/featureSettings.js` defaults an unknown feature to available, so
    // unknown here must permit queueing. Refusing would strand every punch on
    // a first launch, or on a tenant whose backend predates the setting.
    setOfflineQueueingAllowed(null);

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.queued).toBe(true);
    expect(await listAll()).toHaveLength(1);
  });
});

describe("when online", () => {
  it("uses the real call and queues nothing on success", async () => {
    const online = jest.fn().mockResolvedValue({
      allowed: true,
      name: "EMP-CKIN-1",
      message: "Successfully checked in",
    });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(online).toHaveBeenCalled();
    expect(result.name).toBe("EMP-CKIN-1");
    expect(result.queued).toBeUndefined();
    expect(await listAll()).toHaveLength(0);
  });

  // The difference between "you are 300m away" and "the request timed out" is
  // the whole reason userCheckIn now carries its original error.
  it("surfaces a policy refusal instead of queueing it", async () => {
    const online = jest.fn().mockResolvedValue({
      allowed: false,
      message: "You are 300m away from nearest location (Doha HQ).",
    });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/300m away/);
    expect(await listAll()).toHaveLength(0);
  });

  it("queues when the real call fails on the network", async () => {
    const online = jest.fn().mockResolvedValue(networkFailure());

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.allowed).toBe(true);
    expect(result.queued).toBe(true);

    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.PENDING);
  });

  it("queues when the real call throws a transport error", async () => {
    const online = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("timeout of 10000ms exceeded"), {
          code: "ECONNABORTED",
        }),
      );

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.queued).toBe(true);
    expect(await listAll()).toHaveLength(1);
  });

  // A 403 is auth-blocked, not a refusal of the punch — it may well resolve on
  // the next token refresh. Losing the attendance would be the worse outcome, so
  // it is preserved and surfaced through the banner rather than discarded.
  it("queues a 403, because a token refresh may recover it", async () => {
    const online = jest
      .fn()
      .mockRejectedValue({ response: { status: 403, data: { message: "No" } } });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.queued).toBe(true);
    expect(await listAll()).toHaveLength(1);
  });

  // No HTTP status means our own code failed, not the server. Swallowing that
  // into a queue would tell the employee "saved" when nothing was recorded.
  it("surfaces a local error instead of silently queueing it", async () => {
    const online = jest
      .fn()
      .mockRejectedValue(new Error("Location permission denied"));

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/permission denied/i);
    expect(await listAll()).toHaveLength(0);
  });
});

describe("when offline", () => {
  beforeEach(() => fetchIsOnline.mockResolvedValue(false));

  it("queues without attempting the request at all", async () => {
    const online = jest.fn();

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(online).not.toHaveBeenCalled();
    expect(result.queued).toBe(true);
  });

  it("returns success, so the session state machine opens a real session", async () => {
    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    // `performSessionTransition` commits only on `allowed`. Without this an
    // offline check-in would leave no session for a later EXIT to close.
    expect(result.allowed).toBe(true);
    expect(result.message).toMatch(/offline/i);
  });

  it("records the docname the config cache resolved, for the bulk endpoint", async () => {
    await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    const [row] = await listAll();
    expect(row.employeeId).toBe("TDI0167");
    expect(row.employeeDocname).toBe("HR-EMP-00001");
  });

  it("tags the row with the location the gate resolved", async () => {
    await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    const [row] = await listAll();
    expect(row.address).toBe("Doha HQ");
    expect(row.latitude).toBeCloseTo(25.28);
    expect(row.accuracy).toBe(8);
  });

  // Otherwise the restriction is decorative: one flick of aeroplane mode and
  // you can check in from home.
  it("still refuses an out-of-radius punch", async () => {
    evaluateOfflineAttendance.mockResolvedValue({
      allowed: false,
      reason: "out-of-radius",
      message: "You are 812m away from nearest location (Doha HQ).",
    });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/812m away/);
    expect(await listAll()).toHaveLength(0);
  });

  it("refuses everything when configuration has never been downloaded", async () => {
    evaluateOfflineAttendance.mockResolvedValue({
      allowed: false,
      reason: "no-config",
      message: NO_CONFIG_MESSAGE,
    });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.allowed).toBe(false);
    expect(result.message).toBe(NO_CONFIG_MESSAGE);
    expect(await listAll()).toHaveLength(0);
  });
});

// A geofence crossing is the location proof. Re-testing the radius here would
// contradict it — and an EXIT is outside the radius by definition, so it would
// refuse every automatic check-out, in exactly the dead-signal car park this
// feature exists for.
describe("the geofence path is not radius-gated", () => {
  beforeEach(() => fetchIsOnline.mockResolvedValue(false));

  it("asks the gate to skip the radius test for an automatic punch", async () => {
    await submitAutoAttendance({
      type: "OUT",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(evaluateOfflineAttendance).toHaveBeenCalledWith({
      type: "OUT",
      enforceRadius: false,
    });
  });

  it("still enforces it for anything a person can tap", async () => {
    await submitManualAttendance({
      type: "OUT",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(evaluateOfflineAttendance).toHaveBeenCalledWith({
      type: "OUT",
      enforceRadius: true,
    });
  });

  it("queues an automatic check-out taken outside the radius", async () => {
    // What the real gate returns for a geofence punch: allowed, position tagged
    // for the record, no radius verdict applied.
    evaluateOfflineAttendance.mockResolvedValue({
      allowed: true,
      reason: "geofence-verified",
      location: { locationName: "25.350000, 51.600000" },
      coords: { latitude: 25.35, longitude: 51.6, accuracy: 20 },
      config: { employeeDocname: "HR-EMP-00001" },
    });

    const result = await submitAutoAttendance({
      type: "OUT",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    expect(result.allowed).toBe(true);
    expect(result.queued).toBe(true);
    expect(await listAll()).toHaveLength(1);
  });
});

describe("the shared queue", () => {
  beforeEach(() => fetchIsOnline.mockResolvedValue(false));

  it("tags manual and automatic punches distinctly in one table", async () => {
    await submitManualAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });
    await submitAutoAttendance({
      type: "OUT",
      employeeCode: "TDI0167",
      online: jest.fn(),
    });

    const rows = await listAll();
    const types = rows.map((row) => row.attendanceType).sort();

    expect(types).toEqual(["auto", "manual"]);
  });

  it("does not queue the same punch twice", async () => {
    const submit = () =>
      submitAttendance({
        type: "IN",
        employeeCode: "TDI0167",
        online: jest.fn(),
        occurredAt: 1_800_000_000_000,
      });

    const first = await submit();
    const second = await submit();

    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(true);
    expect(await listAll()).toHaveLength(1);
  });
});

describe("shouldQueueFailure", () => {
  it("queues only failures that carry a transport error", () => {
    expect(shouldQueueFailure(networkFailure())).toBe(true);
  });

  it("does not queue a failure the app decided on its own", () => {
    // No `error` field: this came from a code path that made a judgement rather
    // than from a request that failed.
    expect(
      shouldQueueFailure({ allowed: false, message: "Reporting locations are not configured" }),
    ).toBe(false);
  });

  it("queues a server-answered failure it cannot interpret", () => {
    expect(
      shouldQueueFailure({ error: { response: { status: 417, data: {} } } }),
    ).toBe(true);
  });

  it("does not queue a local error, which has no status", () => {
    expect(shouldQueueFailure({ error: new TypeError("boom") })).toBe(false);
  });

  it("does not queue a nullish failure", () => {
    expect(shouldQueueFailure(null)).toBe(false);
  });
});

describe("input validation", () => {
  it("rejects a type that is neither IN nor OUT", async () => {
    await expect(
      submitAttendance({ type: "SIDEWAYS", employeeCode: "TDI0167", online: jest.fn() }),
    ).rejects.toThrow(/invalid type/i);
  });
});

/**
 * `forceQueue` — ordering, not connectivity.
 *
 * An automatic check-in must not overtake a punch the server has not received
 * yet, or the server sees an IN while it still holds the earlier session open.
 * This makes the punch take the queue even though the connection is fine, so it
 * lands behind that punch in the employee's FIFO.
 */
describe("forceQueue", () => {
  it("skips the online attempt and queues instead", async () => {
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      attendanceType: "auto",
      forceQueue: true,
      online,
    });

    expect(online).not.toHaveBeenCalled();
    expect(result).toMatchObject({ allowed: true, queued: true });

    const rows = await listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(QUEUE_STATUS.PENDING);
  });

  it("is off by default, so ordinary punches still go online first", async () => {
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    await submitAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      attendanceType: "auto",
      online,
    });

    expect(online).toHaveBeenCalledTimes(1);
    expect(await listAll()).toHaveLength(0);
  });

  // Ordering is not worth losing a real crossing over. The OS will not deliver
  // the ENTER again, so if the queue cannot take it, send it.
  it("falls back to sending the punch when the queue refuses it", async () => {
    markOfflineSyncUnsupported();
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      attendanceType: "auto",
      forceQueue: true,
      online,
    });

    expect(online).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ allowed: true, name: "X" });
  });

  it("falls back when the offline gate refuses it", async () => {
    evaluateOfflineAttendance.mockResolvedValue({
      allowed: false,
      reason: "no-config",
      message: NO_CONFIG_MESSAGE,
    });
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      attendanceType: "auto",
      forceQueue: true,
      online,
    });

    expect(online).toHaveBeenCalledTimes(1);
    expect(result.allowed).toBe(true);
  });

  // Offline, there is nothing to fall back to — but the punch is queued anyway,
  // which is the pre-existing behaviour and already correctly ordered.
  it("queues normally when there is no connection either", async () => {
    fetchIsOnline.mockResolvedValue(false);
    const online = jest.fn();

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      attendanceType: "auto",
      forceQueue: true,
      online,
    });

    expect(online).not.toHaveBeenCalled();
    expect(result).toMatchObject({ allowed: true, queued: true });
  });

  // The manual helper does not accept the flag at all, so no manual punch can
  // be diverted into the queue by this mechanism.
  it("cannot be triggered through the manual path", async () => {
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    await submitManualAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      forceQueue: true,
      online,
    });

    expect(online).toHaveBeenCalledTimes(1);
    expect(await listAll()).toHaveLength(0);
  });

  it("is forwarded by the geofence helper", async () => {
    const online = jest.fn(() => Promise.resolve({ allowed: true, name: "X" }));

    await submitAutoAttendance({
      type: "IN",
      employeeCode: "HR-EMP-00001",
      forceQueue: true,
      online,
    });

    expect(online).not.toHaveBeenCalled();
    expect(await listAll()).toHaveLength(1);
  });
});

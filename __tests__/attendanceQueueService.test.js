/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));

jest.mock("../services/offline/NetworkListener", () => ({
  __esModule: true,
  fetchIsOnline: jest.fn(() => Promise.resolve(true)),
  isOnline: jest.fn(() => true),
}));

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

  it("does not queue when the real call throws a 403", async () => {
    const online = jest
      .fn()
      .mockRejectedValue({ response: { status: 403, data: { message: "No" } } });

    const result = await submitAttendance({
      type: "IN",
      employeeCode: "TDI0167",
      online,
    });

    expect(result.allowed).toBe(false);
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

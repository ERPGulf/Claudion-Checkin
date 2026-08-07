jest.mock("expo-location", () => ({}));

jest.mock("../services/api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/api/apiClient";
import { getAttendanceStatus } from "../services/api/attendance.service";
import {
  resolveActiveSessionStart,
} from "../utils/attendanceSession";

/**
 * "The server says you are checked out" and "the server did not answer" are not
 * the same fact, and conflating them cost an offline check-in.
 *
 * `getUserAttendance` swallows every failure into `{ error }`. That used to
 * arrive at `getAttendanceStatus` looking exactly like an empty history and
 * become `custom_in: 0`, which `resolveActiveSessionStart` reads as "no session",
 * which `reconcileSessionFromServer` acts on by CLOSING the open one. The
 * offline punch stayed queued and did eventually sync, but the UI reverted to
 * "Check in", a second tap queued a duplicate at a new timestamp, and a later
 * geofence EXIT found no session left to close.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await AsyncStorage.multiSet([
    ["baseUrl", "https://aysha.erpgulf.com"],
    ["access_token", "token"],
    ["employee_id", "TDI0167"],
  ]);
});

describe("getAttendanceStatus when the server cannot be reached", () => {
  it("flags the answer as unavailable rather than reporting checked-out", async () => {
    apiClient.get.mockRejectedValue(
      Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }),
    );

    const status = await getAttendanceStatus();

    expect(status.unavailable).toBe(true);
  });

  it("flags a thrown failure the same way", async () => {
    apiClient.get.mockImplementation(() => {
      throw new TypeError("boom");
    });

    expect((await getAttendanceStatus()).unavailable).toBe(true);
  });

  it("does NOT flag a genuinely empty history", async () => {
    apiClient.get.mockResolvedValue({ data: { message: [] } });

    const status = await getAttendanceStatus();

    expect(status.custom_in).toBe(0);
    expect(status.unavailable).toBeUndefined();
  });

  it("does NOT flag a real answer", async () => {
    apiClient.get.mockResolvedValue({
      data: {
        message: [
          { log_type: "IN", time: "2026-07-28 09:00:00", custom_in: 1 },
        ],
      },
    });

    const status = await getAttendanceStatus();

    expect(status.custom_in).toBe(1);
    expect(status.unavailable).toBeUndefined();
  });
});

describe("why the flag matters", () => {
  // Without the flag this is what the caller was handed, and it is
  // indistinguishable from a real check-out.
  it("an unavailable status still resolves to no active session", () => {
    const resolved = resolveActiveSessionStart({
      status: { custom_in: 0, unavailable: true },
      storedCheckinStartTime: Date.now() - 60_000,
      reduxCheckinTime: null,
      lastCheckoutTime: null,
    });

    // Hence the caller must check `unavailable` BEFORE reconciling — this
    // function cannot save it, which is why the guard lives in the hook.
    expect(resolved).toBeNull();
  });
});

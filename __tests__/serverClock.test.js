import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  SERVER_OFFSET_KEY,
  formatOfflineTimestamp,
  getServerOffset,
  parseServerWallClock,
  rememberServerOffset,
  resetServerClockCache,
} from "../utils/serverClock";

/**
 * Offline, the device clock is the only clock — and it is not trustworthy on its
 * own. Phones run minutes out, and a user who wants an earlier check-in can set
 * theirs back. So the gap to the server is measured while online and reapplied
 * while offline.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  resetServerClockCache();
});

describe("parseServerWallClock", () => {
  // The server sends a naive datetime with no offset and engines disagree on how
  // to parse that, so the digits are read explicitly.
  it("reads the digits the server sent, not a UTC interpretation of them", () => {
    const parsed = parseServerWallClock("2026-07-28 14:05:09");

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(28);
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(5);
    expect(parsed.getSeconds()).toBe(9);
  });

  it("accepts the ISO 'T' spelling too", () => {
    expect(parseServerWallClock("2026-07-28T14:05:09").getHours()).toBe(14);
  });

  it("ignores trailing microseconds", () => {
    expect(parseServerWallClock("2026-07-28 14:05:09.894330").getSeconds()).toBe(9);
  });

  it.each([null, undefined, "", "not a date", 12345])(
    "returns null for %p",
    value => {
      expect(parseServerWallClock(value)).toBeNull();
    },
  );
});

describe("rememberServerOffset", () => {
  it("stores the gap between the two clocks", async () => {
    const deviceNow = new Date(2026, 6, 28, 14, 0, 0).getTime();
    // Server is 90 seconds ahead of this device.
    const offset = await rememberServerOffset("2026-07-28 14:01:30", deviceNow);

    expect(offset).toBe(90 * 1000);
    expect(await AsyncStorage.getItem(SERVER_OFFSET_KEY)).toBe(String(90 * 1000));
  });

  it("handles a device running ahead of the server", async () => {
    const deviceNow = new Date(2026, 6, 28, 14, 2, 0).getTime();
    expect(await rememberServerOffset("2026-07-28 14:00:00", deviceNow)).toBe(
      -120 * 1000,
    );
  });

  // An offset of days is a wrong timezone or a response that was never a
  // timestamp. Applying it would move a punch by days; ignoring it leaves the
  // raw device clock, wrong by minutes at worst.
  it("rejects an implausible offset rather than storing it", async () => {
    const deviceNow = new Date(2026, 6, 28, 14, 0, 0).getTime();
    expect(await rememberServerOffset("2026-08-15 14:00:00", deviceNow)).toBeNull();
    expect(await getServerOffset()).toBe(0);
  });

  it("ignores an unparseable server time", async () => {
    expect(await rememberServerOffset("nonsense", Date.now())).toBeNull();
  });
});

describe("getServerOffset", () => {
  it("is zero before anything has been measured", async () => {
    expect(await getServerOffset()).toBe(0);
  });

  it("survives a restart by reading back from storage", async () => {
    await AsyncStorage.setItem(SERVER_OFFSET_KEY, "45000");
    resetServerClockCache();

    expect(await getServerOffset()).toBe(45000);
  });

  it("discards a stored offset that is no longer plausible", async () => {
    await AsyncStorage.setItem(SERVER_OFFSET_KEY, String(48 * 60 * 60 * 1000));
    resetServerClockCache();

    expect(await getServerOffset()).toBe(0);
  });
});

describe("formatOfflineTimestamp", () => {
  it("emits the format the attendance endpoints expect", async () => {
    const at = new Date(2026, 6, 28, 9, 5, 3).getTime();

    expect(await formatOfflineTimestamp(at)).toBe("2026-07-28 09:05:03");
  });

  it("applies the measured offset, so a wrong phone clock cannot shift a punch", async () => {
    const deviceNow = new Date(2026, 6, 28, 9, 0, 0).getTime();
    // Device is five minutes behind the server.
    await rememberServerOffset("2026-07-28 09:05:00", deviceNow);

    expect(await formatOfflineTimestamp(deviceNow)).toBe("2026-07-28 09:05:00");
  });

  it("falls back to the raw device clock with no offset recorded", async () => {
    const at = new Date(2026, 6, 28, 17, 39, 45).getTime();
    expect(await formatOfflineTimestamp(at)).toBe("2026-07-28 17:39:45");
  });

  it("treats a nonsense timestamp as now rather than emitting an invalid date", async () => {
    expect(await formatOfflineTimestamp(NaN)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});

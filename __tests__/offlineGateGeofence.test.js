import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { evaluateOfflineAttendance } from "../services/offline/offlineAttendanceGate";

/**
 * `enforceRadius: false` — the geofence path.
 *
 * The rule it mirrors is already documented on `autoCheckInOut`: the OS
 * transition IS the location check. An EXIT is outside the radius by definition,
 * so applying the radius test to it refuses every automatic check-out.
 */
const restrictedConfig = {
  employeeId: "TDI0167",
  employeeDocname: "HR-EMP-00001",
  locations: [
    {
      location: "Doha HQ",
      latitude: 25.28,
      longitude: 51.52,
      reporting_radius: 200,
    },
  ],
  rules: { restrictLocation: 1, unrestrictedCheckoutLocation: 0 },
  lastUpdated: Date.now(),
};

/** Well outside the 200m radius — the user has left the building. */
const wellOutside = {
  coords: { latitude: 25.35, longitude: 51.6, accuracy: 15 },
  timestamp: Date.now(),
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getCurrentPositionAsync.mockResolvedValue(wellOutside);
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(restrictedConfig));
});

/**
 * The tenant that does not restrict location at all.
 *
 * Reproduces a real failure from an Android emulator: check in online, enable
 * aeroplane mode, try to check out — and get "Offline attendance is unavailable
 * until attendance configuration has been downloaded". The configuration WAS
 * downloaded. It just contained no reporting locations, because
 * `restrict_location = 0` means there are none to configure, and the guard read
 * an empty array as "nothing cached".
 */
describe("an employee with no location restriction", () => {
  const unrestrictedConfig = {
    employeeId: "TDI0167",
    employeeDocname: "HR-EMP-00011",
    locations: [],
    rules: { restrictLocation: 0, unrestrictedCheckoutLocation: 0 },
    lastUpdated: Date.now(),
  };

  beforeEach(async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(unrestrictedConfig));
  });

  it("can check out offline", async () => {
    const gate = await evaluateOfflineAttendance({ type: "OUT" });

    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe("unrestricted");
  });

  it("can check in offline", async () => {
    expect((await evaluateOfflineAttendance({ type: "IN" })).allowed).toBe(true);
  });

  it("is not blocked when no position can be obtained either", async () => {
    // Nothing to measure against, so a missing fix is not a blocker — the log
    // just goes out untagged, exactly as the online path allows.
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));

    const gate = await evaluateOfflineAttendance({ type: "OUT" });

    expect(gate.allowed).toBe(true);
    expect(gate.location).toBeNull();
  });

  it("still refuses when nothing was ever downloaded", async () => {
    await AsyncStorage.clear();

    const gate = await evaluateOfflineAttendance({ type: "OUT" });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("no-config");
  });
});

/**
 * The mirror case: the policy DOES require a location, but none are configured.
 * That is a misconfiguration, not an uncached device, and it says so.
 */
describe("a restricted employee with no locations configured", () => {
  it("refuses, but blames the configuration rather than the download", async () => {
    await AsyncStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ ...restrictedConfig, locations: [] }),
    );

    const gate = await evaluateOfflineAttendance({ type: "IN" });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("no-usable-location");
    expect(gate.message).toBe("Reporting locations are not configured");
  });
});

describe("a manual punch outside the radius", () => {
  it("is refused, which is the whole point of the gate", async () => {
    const gate = await evaluateOfflineAttendance({ type: "OUT" });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("out-of-radius");
  });
});

describe("a geofence punch outside the radius", () => {
  it("is allowed — leaving is what an EXIT means", async () => {
    const gate = await evaluateOfflineAttendance({
      type: "OUT",
      enforceRadius: false,
    });

    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe("geofence-verified");
  });

  it("still records where it happened", async () => {
    const gate = await evaluateOfflineAttendance({
      type: "OUT",
      enforceRadius: false,
    });

    expect(gate.coords).toMatchObject({ latitude: 25.35, longitude: 51.6 });
    expect(gate.location.locationName).toBe("25.350000, 51.600000");
  });

  // Indoors with no assisted positioning, a fresh fix often does not arrive.
  // The OS already proved the crossing; refusing on a missing fix would drop it.
  it("is allowed even when no position can be obtained at all", async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));

    const gate = await evaluateOfflineAttendance({
      type: "IN",
      enforceRadius: false,
    });

    expect(gate.allowed).toBe(true);
    expect(gate.location).toBeNull();
  });

  // The one refusal that still applies: with no cached rules there is no
  // employee docname and no policy, so there is nothing to queue against.
  it("is still refused when configuration has never been downloaded", async () => {
    await AsyncStorage.clear();

    const gate = await evaluateOfflineAttendance({
      type: "OUT",
      enforceRadius: false,
    });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("no-config");
  });
});

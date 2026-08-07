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

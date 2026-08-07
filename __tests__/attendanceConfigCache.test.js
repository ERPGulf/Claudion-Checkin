jest.mock("../services/api/employee.service", () => ({
  __esModule: true,
  fetchEmployeeData: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CONFIG_KEY,
  NO_CONFIG_MESSAGE,
  buildConfig,
  clearAttendanceConfig,
  hasAttendanceConfig,
  readAttendanceConfig,
  refreshAttendanceConfig,
  refreshAttendanceConfigIfStale,
} from "../services/offline/attendanceConfigCache";
import { fetchEmployeeData } from "../services/api/employee.service";

/**
 * The cache is what makes offline validation possible at all, so its two rules
 * carry the weight: never replace a good cache with a failed download, and never
 * pretend to have rules that were never downloaded.
 */
const employeeResponse = (overrides = {}) => ({
  name: "HR-EMP-00001",
  employee_name: "Aysha Sithara",
  restrict_location: 1,
  unrestricted_checkout_location: 0,
  photo: 0,
  geotagging: 2,
  employee_locations: [
    { location: "Doha HQ", latitude: 25.28, longitude: 51.52, reporting_radius: 100 },
  ],
  ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("buildConfig", () => {
  it("captures the identifiers, locations and rules the gate needs", () => {
    const config = buildConfig(employeeResponse(), {
      employeeId: "TDI0167",
      now: 1000,
    });

    expect(config).toMatchObject({
      employeeId: "TDI0167",
      employeeDocname: "HR-EMP-00001",
      lastUpdated: 1000,
      rules: {
        restrictLocation: 1,
        unrestrictedCheckoutLocation: 0,
        photo: 0,
        geotagging: 2,
      },
    });
    expect(config.locations).toHaveLength(1);
  });

  // The bulk endpoint takes `employee`, which the online endpoint never needed,
  // and which field carries it varies by tenant.
  it("falls back through the plausible docname fields", () => {
    expect(
      buildConfig({ employee: "TDI0167" }, { employeeId: "TDI0167" })
        .employeeDocname,
    ).toBe("TDI0167");
  });

  it("leaves the docname null when the response carries none", () => {
    expect(
      buildConfig({ employee_locations: [] }, { employeeId: "TDI0167" })
        .employeeDocname,
    ).toBeNull();
  });

  it("coerces missing rule flags to 0 rather than undefined", () => {
    const config = buildConfig({}, { employeeId: "TDI0167" });
    expect(config.rules.restrictLocation).toBe(0);
    expect(config.locations).toEqual([]);
  });
});

describe("refreshAttendanceConfig", () => {
  it("caches a successful download", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());

    const result = await refreshAttendanceConfig("TDI0167");

    expect(result.refreshed).toBe(true);
    expect((await readAttendanceConfig()).employeeDocname).toBe("HR-EMP-00001");
  });

  // The legacy per-key mirror: plenty of existing code reads these directly, and
  // a background refresh should keep them current rather than leaving them on
  // whatever the last GPS-taking call happened to store.
  it("keeps the individual AsyncStorage keys in step", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());

    await refreshAttendanceConfig("TDI0167");

    expect(await AsyncStorage.getItem("restrict_location")).toBe("1");
    expect(await AsyncStorage.getItem("geotagging")).toBe("2");
    expect(JSON.parse(await AsyncStorage.getItem("employee_locations"))).toHaveLength(1);
  });

  // A stale cache is last week's offices; an emptied one is no offices at all,
  // and the gate would refuse every punch.
  it("keeps the previous cache when the download fails", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfig("TDI0167");

    fetchEmployeeData.mockRejectedValue(new Error("Network Error"));
    const result = await refreshAttendanceConfig("TDI0167");

    expect(result.refreshed).toBe(false);
    expect(result.error).toBe("Network Error");
    expect((await readAttendanceConfig()).locations).toHaveLength(1);
  });

  it("never throws, so a speculative refresh cannot break a caller", async () => {
    fetchEmployeeData.mockRejectedValue(new Error("boom"));
    await expect(refreshAttendanceConfig("TDI0167")).resolves.toBeDefined();
  });

  // A successful request returning no locations is ambiguous — it can be a
  // partial record — and overwriting with it would silently disable offline
  // attendance.
  it("does not let an empty location list overwrite a good cache", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfig("TDI0167");

    fetchEmployeeData.mockResolvedValue(employeeResponse({ employee_locations: [] }));
    const result = await refreshAttendanceConfig("TDI0167");

    expect(result.refreshed).toBe(false);
    expect((await readAttendanceConfig()).locations).toHaveLength(1);
  });

  // An employee with `restrict_location = 0` has no reporting locations by
  // design, so their cached configuration carries an empty array. Reading that
  // as "nothing downloaded" locked every unrestricted employee out of offline
  // attendance — they were told to go online and fetch a configuration they
  // already had.
  it("caches an empty list, and still counts it as configuration", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse({ employee_locations: [] }));

    const result = await refreshAttendanceConfig("TDI0167");

    expect(result.refreshed).toBe(true);
    expect(await hasAttendanceConfig()).toBe(true);
  });

  it("does not spend a request with no employee code", async () => {
    await refreshAttendanceConfig(null);
    expect(fetchEmployeeData).not.toHaveBeenCalled();
  });
});

describe("refreshAttendanceConfigIfStale", () => {
  it("skips the request while the cache is fresh", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfig("TDI0167");
    fetchEmployeeData.mockClear();

    await refreshAttendanceConfigIfStale("TDI0167", { now: Date.now() });

    expect(fetchEmployeeData).not.toHaveBeenCalled();
  });

  it("refreshes once the cache is past its age", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfig("TDI0167");
    fetchEmployeeData.mockClear();

    await refreshAttendanceConfigIfStale("TDI0167", {
      now: Date.now() + 7 * 60 * 60 * 1000,
    });

    expect(fetchEmployeeData).toHaveBeenCalled();
  });

  it("always refreshes when there is no cache at all", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfigIfStale("TDI0167");
    expect(fetchEmployeeData).toHaveBeenCalled();
  });
});

describe("reading", () => {
  it("reports no config on a device that has never been online", async () => {
    expect(await readAttendanceConfig()).toBeNull();
    expect(await hasAttendanceConfig()).toBe(false);
  });

  it("treats a corrupt blob as absent rather than throwing", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, "{not json");
    expect(await readAttendanceConfig()).toBeNull();
  });

  it("treats a blob with no locations array as absent", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ employeeId: "X" }));
    expect(await readAttendanceConfig()).toBeNull();
  });

  it("has a message to show when offline attendance is impossible", () => {
    expect(NO_CONFIG_MESSAGE).toMatch(/downloaded at least once/i);
  });
});

describe("clearAttendanceConfig", () => {
  // The previous employee's reporting locations must not govern the next one's
  // offline check-ins.
  it("drops the cache on logout", async () => {
    fetchEmployeeData.mockResolvedValue(employeeResponse());
    await refreshAttendanceConfig("TDI0167");

    await clearAttendanceConfig();

    expect(await readAttendanceConfig()).toBeNull();
  });
});

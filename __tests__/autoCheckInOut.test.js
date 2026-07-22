import AsyncStorage from "@react-native-async-storage/async-storage";

// attendance.service.js pulls in expo-location / geolib at module load for
// getOfficeLocation; autoCheckInOut uses neither, so stub them to keep this a
// focused unit test (jest-expo does not transform these node_modules).
jest.mock("expo-location", () => ({}));
jest.mock("geolib", () => ({ getPreciseDistance: jest.fn() }));

// Mock the axios instance the service posts through so no real network happens.
jest.mock("../services/api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import apiClient from "../services/api/apiClient";
import { autoCheckInOut } from "../services/api/attendance.service";

const ADD_LOG_ENDPOINT = "add_log_based_on_employee_field";

describe("autoCheckInOut (geofence-driven attendance)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await AsyncStorage.setItem("baseUrl", "https://demo.erpgulf.com");
    await AsyncStorage.setItem("access_token", "tok-123");
    // getServerTime() reads through apiClient.get
    apiClient.get.mockResolvedValue({
      data: { message: { server_time: "2026-07-23 10:00:00" } },
    });
    apiClient.post.mockResolvedValue({
      data: { message: { name: "EMP-CHKIN-001" } },
    });
  });

  it("checks OUT when leaving the office even though restrict_location is on and the user is outside the radius", async () => {
    // This is the whole point of the separate function: a geofence EXIT means
    // the user is outside the radius, which the manual userCheckIn would reject.
    await AsyncStorage.setItem("restrict_location", "1");
    await AsyncStorage.setItem("unrestricted_checkout_location", "0");

    const result = await autoCheckInOut({
      employeeCode: "HR-EMP-00011",
      type: "OUT",
    });

    expect(result.allowed).toBe(true);
    expect(result.name).toBe("EMP-CHKIN-001");
    expect(apiClient.post).toHaveBeenCalledTimes(1);

    const [url, payload] = apiClient.post.mock.calls[0];
    expect(url).toContain(ADD_LOG_ENDPOINT);
    expect(payload).toMatchObject({
      device_id: "MobileAPP",
      employee_field_value: "HR-EMP-00011",
      log_type: "OUT",
    });
    expect(payload.timestamp).toBeTruthy();
  });

  it("tags the log with the office location when one is supplied", async () => {
    await autoCheckInOut({
      employeeCode: "HR-EMP-00011",
      type: "IN",
      office: { locationName: "kozhikode", latitude: 11.53, longitude: 75.67 },
    });

    const [, payload] = apiClient.post.mock.calls[0];
    expect(payload).toMatchObject({
      location: "kozhikode",
      latitude: 11.53,
      longitude: 75.67,
    });
  });

  it("omits location fields when no office is supplied", async () => {
    await autoCheckInOut({ employeeCode: "HR-EMP-00011", type: "OUT" });
    const [, payload] = apiClient.post.mock.calls[0];
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(payload.location).toBeUndefined();
  });

  it("returns allowed:false when the backend returns no log name", async () => {
    apiClient.post.mockResolvedValue({ data: { message: {} } });
    const result = await autoCheckInOut({
      employeeCode: "HR-EMP-00011",
      type: "OUT",
    });
    expect(result.allowed).toBe(false);
  });

  it("rejects an invalid attendance type without calling the API", async () => {
    const result = await autoCheckInOut({
      employeeCode: "HR-EMP-00011",
      type: "BOGUS",
    });
    expect(result.allowed).toBe(false);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

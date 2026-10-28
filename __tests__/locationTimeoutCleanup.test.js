import * as Location from "expo-location";
import { getPositionForOfflineCheck } from "../services/offline/offlineAttendanceGate";
import { readDevicePosition } from "../utils/autoAttendance";

const fix = { coords: { latitude: 25, longitude: 51, accuracy: 10 }, timestamp: Date.now() };

beforeEach(() => {
  jest.useFakeTimers();
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getCurrentPositionAsync.mockResolvedValue(fix);
  Location.getLastKnownPositionAsync.mockResolvedValue(fix);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it.each([getPositionForOfflineCheck, readDevicePosition])("releases the GPS deadline after a successful fix", async read => {
  const timersBefore = jest.getTimerCount();
  await read();
  expect(jest.getTimerCount()).toBe(timersBefore);
});

it.each([getPositionForOfflineCheck, readDevicePosition])("releases the GPS deadline when live GPS fails and cached position is used", async read => {
  const timersBefore = jest.getTimerCount();
  Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error("Synthetic GPS failure"));
  await read();
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(timersBefore);
});

it.each([[getPositionForOfflineCheck, 12000], [readDevicePosition, 8000]])("retains the fallback when the actual GPS deadline expires", async (read, timeout) => {
  Location.getCurrentPositionAsync.mockImplementationOnce(() => new Promise(() => {}));
  const pending = read();
  await jest.advanceTimersByTimeAsync(timeout);
  const result = await pending;
  expect(result).toBeTruthy();
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

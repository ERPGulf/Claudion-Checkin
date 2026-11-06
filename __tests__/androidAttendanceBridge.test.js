jest.mock("expo", () => {
  const native = {};
  return { requireOptionalNativeModule: () => native };
});
import { requireOptionalNativeModule } from "expo";
import {
  scheduleBackgroundSync, completeBackgroundSync, isBackgroundSyncActive, recordBackgroundSyncDiagnostic, getBackgroundSyncDiagnostics,
} from "../modules/expo-auto-attendance";

const native = requireOptionalNativeModule();
beforeEach(() => Object.keys(native).forEach(key => delete native[key]));

it("tolerates older binaries and iOS without the additive Android APIs", () => {
  expect(scheduleBackgroundSync()).toBeUndefined();
  expect(completeBackgroundSync("synthetic-run", true)).toBe(false);
  expect(isBackgroundSyncActive("synthetic-run")).toBe(null);
  expect(recordBackgroundSyncDiagnostic("test", null, {})).toBeUndefined();
  expect(getBackgroundSyncDiagnostics()).toEqual([]);
});

it("queries the exact native pass and refuses new work if that query fails", () => {
  native.isBackgroundSyncActive = jest.fn(() => true);
  expect(isBackgroundSyncActive("synthetic-running")).toBe(true);
  expect(native.isBackgroundSyncActive).toHaveBeenCalledWith("synthetic-running");
  native.isBackgroundSyncActive.mockReturnValueOnce(false);
  expect(isBackgroundSyncActive("synthetic-stopped")).toBe(false);
  native.isBackgroundSyncActive.mockImplementationOnce(() => { throw new Error("synthetic bridge failure"); });
  expect(isBackgroundSyncActive("synthetic-error")).toBe(false);
});

it("forwards durable scheduling completion and its rejection to the caller", async () => {
  native.scheduleBackgroundSync = jest.fn(async () => true);
  await expect(scheduleBackgroundSync()).resolves.toBe(true);
  native.scheduleBackgroundSync.mockRejectedValue(new Error("synthetic schedule failure"));
  await expect(scheduleBackgroundSync()).rejects.toThrow("synthetic schedule failure");
});

it("forwards the run completion and structured lifecycle metadata", () => {
  native.completeBackgroundSync = jest.fn(() => true);
  native.recordBackgroundSyncDiagnostic = jest.fn();
  native.getBackgroundSyncDiagnostics = jest.fn(() => [{ stage: "worker.start" }]);
  expect(completeBackgroundSync("synthetic-run", true)).toBe(true);
  expect(native.completeBackgroundSync).toHaveBeenCalledWith("synthetic-run", true);
  recordBackgroundSyncDiagnostic("queue.persisted", null, { queueId: 1 });
  expect(native.recordBackgroundSyncDiagnostic).toHaveBeenCalledWith("queue.persisted", null, { queueId: 1 });
  expect(getBackgroundSyncDiagnostics()).toEqual([{ stage: "worker.start" }]);
});

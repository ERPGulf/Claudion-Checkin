jest.mock("expo", () => {
  const native = {};
  return { requireOptionalNativeModule: () => native };
});
import { requireOptionalNativeModule } from "expo";
import {
  supportsIOSBackgroundSync, getPendingBackgroundSync, isIOSBackgroundSyncActive,
  completeIOSBackgroundSync, addBackgroundSyncRequestedListener, addBackgroundSyncExpiredListener,
} from "../modules/expo-auto-attendance";

const native = requireOptionalNativeModule();
beforeEach(() => Object.keys(native).forEach(key => delete native[key]));
const install = () => {
  native.getPendingBackgroundSync = jest.fn(() => ({ runId: "synthetic", revision: 2, deadline: 1234 }));
  native.isIOSBackgroundSyncActive = jest.fn(() => true);
  native.completeIOSBackgroundSync = jest.fn(() => true);
  native.addListener = jest.fn(() => ({ remove: jest.fn() }));
};

it("tolerates older binaries and Android without iOS wake support", () => {
  expect(supportsIOSBackgroundSync()).toBe(false);
  expect(getPendingBackgroundSync()).toBeNull();
  expect(isIOSBackgroundSyncActive("synthetic")).toBe(false);
  expect(completeIOSBackgroundSync("synthetic", 1, true)).toBe(false);
  expect(() => addBackgroundSyncRequestedListener(jest.fn()).remove()).not.toThrow();
  expect(() => addBackgroundSyncExpiredListener(jest.fn()).remove()).not.toThrow();
});

it("preserves native wake identity/revision for completion and event subscription", () => {
  install();
  expect(supportsIOSBackgroundSync()).toBe(true);
  expect(getPendingBackgroundSync()).toEqual({ runId: "synthetic", revision: 2, deadline: 1234 });
  expect(isIOSBackgroundSyncActive("synthetic")).toBe(true);
  completeIOSBackgroundSync("synthetic", 2, true);
  expect(native.completeIOSBackgroundSync).toHaveBeenCalledWith("synthetic", 2, true);
  const listener = jest.fn();
  addBackgroundSyncRequestedListener(listener);
  addBackgroundSyncExpiredListener(listener);
  expect(native.addListener.mock.calls).toEqual([
    ["onBackgroundSyncRequested", listener], ["onBackgroundSyncExpired", listener],
  ]);
});

it("fails closed when the native liveness query fails", () => {
  install();
  native.isIOSBackgroundSyncActive.mockImplementation(() => { throw new Error("Synthetic bridge failure"); });
  expect(isIOSBackgroundSyncActive("synthetic")).toBe(false);
});

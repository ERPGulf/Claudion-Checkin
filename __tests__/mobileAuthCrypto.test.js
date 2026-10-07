jest.mock("expo-crypto", () => ({ getRandomValues: jest.fn((array) => array.fill(7)) }));

import { getRandomValues } from "expo-crypto";
import { installMobileAuthCrypto, isMobileAuthAvailable } from "../utils/mobileAuthCrypto";

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: undefined });
  getRandomValues.mockImplementation((array) => array.fill(7));
  jest.clearAllMocks();
});

afterEach(() => {
  if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
  else delete globalThis.crypto;
});

it("keeps an existing secure random source", () => {
  const existing = jest.fn();
  globalThis.crypto = { getRandomValues: existing };
  expect(installMobileAuthCrypto()).toBe(true);
  expect(globalThis.crypto.getRandomValues).toBe(existing);
  expect(getRandomValues).not.toHaveBeenCalled();
});

it("installs and exercises the native source before showing mobile sign-in", () => {
  expect(isMobileAuthAvailable()).toBe(false);
  expect(installMobileAuthCrypto()).toBe(true);
  expect(getRandomValues).toHaveBeenCalledTimes(1);
  expect(globalThis.crypto.getRandomValues(new Uint8Array(2))).toEqual(new Uint8Array([7, 7]));
});

it("keeps mobile sign-in unavailable when native random generation fails", () => {
  getRandomValues.mockImplementation(() => { throw new Error("synthetic missing native module"); });
  expect(installMobileAuthCrypto()).toBe(false);
  expect(isMobileAuthAvailable()).toBe(false);
});

it("does not crash when the older binary cannot load ExpoCrypto", () => {
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock("expo-crypto", () => { throw new Error("synthetic missing ExpoCrypto"); });
    const helper = require("../utils/mobileAuthCrypto");
    expect(helper.installMobileAuthCrypto()).toBe(false);
  });
});

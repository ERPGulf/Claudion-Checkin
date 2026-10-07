const { createHash } = require("crypto");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const mockUpdates = {
  updateId: "abcd1234-0000-4000-8000-000000000000",
  channel: "preview",
  runtimeVersion: "1.2.1-sdk57",
  isEmbeddedLaunch: false,
  isEnabled: true,
};

let instance;
let api;
let mockDigest;

/** A fresh copy of the service, with or without the native module present. */
const loadService = ({ native = true } = {}) => {
  jest.resetModules();
  instance = { isCrashlyticsCollectionEnabled: true };
  api = {
    getCrashlytics: jest.fn(() => instance),
    setAttributes: jest.fn(() => Promise.resolve(null)),
    setUserId: jest.fn(() => Promise.resolve(null)),
    log: jest.fn(),
    recordError: jest.fn(),
    crash: jest.fn(),
  };
  // The real package throws on import when its native module is missing.
  jest.doMock("@react-native-firebase/crashlytics", () => {
    if (!native) throw new Error("RNFBCrashlyticsModule is not installed natively");
    return api;
  });
  jest.doMock("expo-updates", () => mockUpdates);
  mockDigest = jest.fn(async (_algorithm, text) => sha256(text));
  jest.doMock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: (...args) => mockDigest(...args),
  }));
  return require("../services/crashlytics.service");
};

afterEach(() => {
  global.__DEV__ = true;
  mockUpdates.channel = "preview";
});

it("is a silent no-op on a binary without the native module", async () => {
  const service = loadService({ native: false });

  expect(service.initializeCrashReporting()).toBe(false);
  expect(() => {
    service.recordNonFatalError(new TypeError("boom"));
    service.setCrashAttributes({ tenant: "acme.example.com" });
    service.setCrashScreen("Home");
    service.logCrashEvent("breadcrumb");
    service.clearCrashUser();
    service.recordTestNonFatal();
    service.triggerTestCrash();
  }).not.toThrow();
  await expect(
    service.setCrashUser({ employeeId: "EMP-1", tenantUrl: "https://acme.example.com" }),
  ).resolves.toBeUndefined();
  expect(service.canRunCrashTests()).toBe(false);
  expect(service.isCrashCollectionEnabled()).toBe(false);
});

it("labels the running JS bundle at start-up", () => {
  const service = loadService();

  expect(service.initializeCrashReporting()).toBe(true);
  expect(api.setAttributes).toHaveBeenCalledWith(instance, {
    ota_source: "ota",
    ota_update: "abcd1234",
    ota_channel: "preview",
    runtime_version: "1.2.1-sdk57",
  });
});

it("turns thrown values into Errors without serialising objects", () => {
  const { toError } = loadService();
  const original = new RangeError("Invalid time value");

  expect(toError(original)).toBe(original);
  expect(toError("plain message").message).toBe("plain message");
  expect(toError({ message: "from an object" }).message).toBe("from an object");

  const payload = toError({ access_token: "secret-token", data: { full_name: "Jane Doe" } });
  expect(payload).toBeInstanceOf(Error);
  expect(payload.message).toBe("Non-Error value thrown (object)");
  expect(toError(null).message).toBe("Non-Error value thrown (null)");
  expect(toError(undefined).message).toBe("Non-Error value thrown (undefined)");
});

it("treats only engine errors from our own code as bugs", () => {
  const { isProgrammingError } = loadService();
  const axiosError = Object.assign(new Error("Request failed with status code 417"), {
    response: { status: 417 },
  });

  expect(isProgrammingError(new TypeError("Cannot read property 'x' of undefined"))).toBe(true);
  expect(isProgrammingError(new SyntaxError("JSON Parse error: Unexpected character"))).toBe(true);
  expect(isProgrammingError(new TypeError("Network request failed"))).toBe(false);
  expect(isProgrammingError(axiosError)).toBe(false);
  expect(isProgrammingError(new Error("Location permission denied"))).toBe(false);
  expect(isProgrammingError(undefined)).toBe(false);
});

it("records a non-fatal once per session, named after its call site", () => {
  const service = loadService();
  service.initializeCrashReporting();
  const error = new TypeError("Cannot read property 'x' of undefined");
  const context = { feature: "attendance", action: "manual_punch", type: "IN" };

  service.recordNonFatalError(error, context);
  service.recordNonFatalError(error, context);

  expect(api.recordError).toHaveBeenCalledTimes(1);
  expect(api.recordError).toHaveBeenCalledWith(instance, error, "attendance.manual_punch");
  expect(api.log).toHaveBeenCalledWith(
    instance,
    "non-fatal TypeError feature=attendance action=manual_punch type=IN",
  );
});

it("sends only short primitive attribute values", () => {
  const service = loadService();
  service.initializeCrashReporting();

  service.setCrashAttributes({
    screen: "x".repeat(150),
    retries: 3,
    payload: { token: "secret" },
    missing: undefined,
  });

  expect(api.setAttributes).toHaveBeenLastCalledWith(instance, {
    screen: "x".repeat(100),
    retries: "3",
  });
});

it("identifies the employee only by a hash, and a sign-out while hashing wins", async () => {
  const service = loadService();
  service.initializeCrashReporting();
  const user = {
    employeeId: "Jane Doe",
    tenantUrl: "https://acme.example.com/",
    authMethod: "mobile",
  };

  let release;
  mockDigest.mockImplementationOnce(
    (_algorithm, text) =>
      new Promise((resolve) => {
        release = () => resolve(sha256(text));
      }),
  );
  const superseded = service.setCrashUser(user);
  service.clearCrashUser();
  release();
  await superseded;
  expect(api.setUserId.mock.calls).toEqual([[instance, ""]]);

  await service.setCrashUser(user);

  expect(mockDigest).toHaveBeenLastCalledWith("SHA-256", "Jane Doe@acme.example.com");
  expect(api.setUserId).toHaveBeenLastCalledWith(
    instance,
    sha256("Jane Doe@acme.example.com").slice(0, 16),
  );
  expect(api.setAttributes).toHaveBeenLastCalledWith(instance, {
    tenant: "acme.example.com",
    auth_method: "mobile",
  });
  expect(
    JSON.stringify([api.setUserId.mock.calls, api.setAttributes.mock.calls, api.log.mock.calls]),
  ).not.toContain("Jane");
});

it("offers the test actions only on development and preview builds", () => {
  const service = loadService();
  service.initializeCrashReporting();

  global.__DEV__ = false;
  mockUpdates.channel = "production";
  expect(service.canRunCrashTests()).toBe(false);
  expect(service.recordTestNonFatal()).toBe(false);
  expect(service.triggerTestCrash()).toBe(false);
  expect(api.recordError).not.toHaveBeenCalled();
  expect(api.crash).not.toHaveBeenCalled();

  mockUpdates.channel = "preview";
  expect(service.recordTestNonFatal()).toBe(true);
  expect(service.recordTestNonFatal()).toBe(true);
  expect(api.recordError).toHaveBeenCalledTimes(2);
  expect(api.recordError.mock.calls[0][1].message).toBe("CRASHLYTICS_TEST_NON_FATAL");
  expect(service.triggerTestCrash()).toBe(true);
  expect(api.crash).toHaveBeenCalledWith(instance);
});

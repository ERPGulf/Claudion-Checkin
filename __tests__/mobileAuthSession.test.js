jest.mock("../services/api/notification.service", () => ({ getNotifications: jest.fn() }));
jest.mock("react-native-toast-message/lib/src/Toast", () => ({ Toast: { show: jest.fn() } }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";
import MockAdapter from "axios-mock-adapter";
import { createAuthClient } from "@erpgulf/auth-sdk";
import * as apiClient from "../services/api/apiClient";
import { getNotifications } from "../services/api/notification.service";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { completeMobileSignIn, getMobileAuthClient } from "../services/api/mobileAuth.service";
import { invalidateAuthSession, getAuthSessionGeneration } from "../utils/authSessionGuard";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { SESSION_STATE_KEY } from "../utils/attendanceSessionState";
import { userCheckIn, getOfficeLocation } from "../services/api/attendance.service";

const BASE_URL = "https://mobile.example.test";
const EMPLOYEE_CODE = "FAKE-QR-CODE";
const DOCNAME = "HR-EMP-FAKE";
const ACCESS = "obviously-fake-sdk-access";
const REFRESH = "obviously-fake-sdk-refresh";
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

const rawEmployee = (overrides = {}) => ({
  name: DOCNAME,
  employee_code: EMPLOYEE_CODE,
  employee_name: "Fake Employee",
  restrict_location: 1,
  unrestricted_checkout_location: 0,
  photo: 0,
  geotagging: 0,
  employee_locations: [{ latitude: 25, longitude: 51, reporting_radius: 100 }],
  ...overrides,
});

const sdkSuccess = (token = {}) => ({
  status: "success",
  data: {
    token: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: "Bearer", scope: "all openid", ...token },
    employee: { id: DOCNAME, employee_name: "Fake Employee", phone: "5550001", email: null },
    password_policy: "Mandatory",
    otp_policy: "No",
    time: "2026-01-01 00:00:00",
  },
});

const masterBody = { data: { access_token: "fake-master-token", refresh_token: "fake-master-refresh", expires_in: 3600, token_type: "Bearer", scope: "all openid" } };
const policyBody = (passwordPolicy = "Mandatory", otpPolicy = "No") => ({
  status: "success", employee_id: DOCNAME,
  employee_has_existing_password: true, employee_has_signed_up: true,
  sign_up_policy: { password_policy: passwordPolicy, otp_policy: "Mandatory" },
  sign_in_policy: { password_policy: passwordPolicy, otp_policy: otpPolicy },
  cold_boot_policy: { password_policy: passwordPolicy, otp_policy: otpPolicy },
});

let transport;
const createSdkFlow = async ({ success = sdkSuccess(), finish, passwordPolicy = "Mandatory", otpPolicy = "No" } = {}) => {
  transport = { request: jest.fn(async ({ url }) => {
    if (url.endsWith("master_token")) {
      return { status: 200, body: masterBody };
    }
    if (url.endsWith("get_employee_login_policy")) {
      return { status: 200, body: policyBody(passwordPolicy, otpPolicy) };
    }
    if (url.endsWith("sign_in_api")) {
      if (finish) await finish();
      return { status: 200, body: success };
    }
    throw new Error("Unexpected synthetic transport endpoint");
  }) };
  const auth = createAuthClient({ baseUrl: BASE_URL, transport });
  return { auth, flow: await auth.begin({ mobileNumber: "5550001" }) };
};

let plainMock;
let saveSpy;
let dispatch;
const complete = async (options = {}) => {
  const { success, finish, passwordPolicy, otpPolicy, ...extra } = options;
  const sdk = await createSdkFlow({ success, finish, passwordPolicy, otpPolicy });
  return completeMobileSignIn({ ...sdk, credentials: { password: "fake-password" }, baseUrl: BASE_URL, dispatch, ...extra });
};

beforeEach(async () => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: require("crypto").webcrypto });
  await apiClient.clearTokens();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ["baseUrl", BASE_URL], ["api_key", "old-fake-qr-key"], ["app_key", "old-fake-app-key"],
    ["company", "Old fake company"], ["employee_code", "OLD-FAKE-CODE"],
    ["restrict_location", "0"], ["photo", "1"],
  ]);
  plainMock = new MockAdapter(apiClient.plainAxios);
  plainMock.onGet(`${BASE_URL}/api/method/employee_app.attendance_api.get_employee_data`)
    .reply(200, { message: rawEmployee() });
  getNotifications.mockResolvedValue([{ read: 0 }, { read: "1" }, { read: "0" }]);
  dispatch = jest.fn();
  saveSpy = jest.spyOn(apiClient, "saveTokens");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.clearAllMocks();
});

afterEach(() => {
  plainMock.restore();
  jest.restoreAllMocks();
  if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
  else delete globalThis.crypto;
});

it("hands real SDK completion into the existing token writer and publishes identity before sign-in", async () => {
  dispatch.mockImplementation((action) => {
    if (action.type === "userAuth/setSignIn") {
      expect(AsyncStorage.setItem.mock.calls.some(([key]) => key === CONFIG_KEY)).toBe(true);
    }
  });
  await expect(complete()).resolves.toEqual({ status: "authenticated" });
  expect(saveSpy).toHaveBeenCalledWith(ACCESS, REFRESH, getAuthSessionGeneration());
  const values = Object.fromEntries(await AsyncStorage.multiGet([
    "baseUrl", "employee_code", "employee_id", "full_name", "access_token", "refresh_token", "auth_method", "restrict_location", "photo",
  ]));
  expect(values).toEqual({
    baseUrl: BASE_URL, employee_code: EMPLOYEE_CODE, employee_id: EMPLOYEE_CODE,
    full_name: "Fake Employee", access_token: ACCESS, refresh_token: REFRESH,
    auth_method: "mobile", restrict_location: "1", photo: "0",
  });
  expect(await AsyncStorage.getItem("api_key")).toBeNull();
  expect(await AsyncStorage.getItem("app_key")).toBeNull();
  expect(await AsyncStorage.getItem("company")).toBeNull();
  expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
    "user/setUsername", "user/setUserDetails", "user/setBaseUrl", "user/setEmployeeCode", "user/setFullname",
    "userAuth/setSignIn", "notification/setUnreadCount",
  ]);
  expect(dispatch.mock.calls[6][0].payload).toBe(2);
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: "success", text1: "Login successful" }));
});

it("completes the real SDK's OTP-only flow using secure random values and no app-supplied password", async () => {
  const success = sdkSuccess();
  success.data.password_policy = "No";
  success.data.otp_policy = "Mandatory";
  await expect(complete({
    success, passwordPolicy: "No", otpPolicy: "Mandatory", credentials: { otp: "111111" },
  })).resolves.toEqual({ status: "authenticated" });
  expect(saveSpy).toHaveBeenCalledWith(ACCESS, REFRESH, getAuthSessionGeneration());
  const signIn = transport.request.mock.calls.find(([request]) => request.url.endsWith("sign_in_api"))[0];
  const form = new URLSearchParams(signIn.body);
  expect(form.get("otp")).toBe("111111");
  expect(form.get("password")).toMatch(/^egf_[A-Za-z0-9]+$/);
});

it.each(["", undefined])("does not write anything without a refresh token (%s)", async (refresh_token) => {
  await expect(complete({ success: sdkSuccess({ refresh_token }) })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect(saveSpy).not.toHaveBeenCalled();
  expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it("does not write anything when the SDK completion belongs to an invalidated generation", async () => {
  await expect(complete({ finish: () => invalidateAuthSession() })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(saveSpy).not.toHaveBeenCalled();
  expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it("refuses an unconfirmed QR code instead of assuming the SDK id is the attendance code", async () => {
  plainMock.resetHandlers();
  plainMock.onGet().reply(200, { message: rawEmployee({ employee_code: undefined }) });
  await expect(complete()).rejects.toMatchObject({ code: "MOBILE_IDENTITY_UNVERIFIED" });
  expect(saveSpy).not.toHaveBeenCalled();
  expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem("api_key")).toBe("old-fake-qr-key");
});

it("does not replace provisioning when the policy is incomplete", async () => {
  plainMock.resetHandlers();
  plainMock.onGet().reply(200, { message: rawEmployee({ restrict_location: undefined }) });
  await expect(complete()).rejects.toMatchObject({ code: "MOBILE_POLICY_UNAVAILABLE" });
  expect(saveSpy).not.toHaveBeenCalled();
  expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
});

it("waits for the backend policy before committing or enabling attendance", async () => {
  let release;
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  plainMock.resetHandlers();
  plainMock.onGet().reply(() => new Promise((resolve) => {
    release = () => resolve([200, { message: rawEmployee() }]);
    requested();
  }));
  const pending = complete();
  await started;
  expect(saveSpy).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  release();
  await pending;
  expect(saveSpy).toHaveBeenCalled();
});

it("restores coherent QR provisioning if the existing token writer fails", async () => {
  saveSpy.mockRejectedValueOnce(new Error("synthetic disk failure"));
  await expect(complete()).rejects.toThrow("synthetic disk failure");
  const previous = Object.fromEntries(await AsyncStorage.multiGet([
    "baseUrl", "api_key", "app_key", "employee_code", "auth_method", "access_token", "refresh_token",
  ]));
  expect(previous).toEqual({
    baseUrl: BASE_URL, api_key: "old-fake-qr-key", app_key: "old-fake-app-key",
    employee_code: "OLD-FAKE-CODE", auth_method: null, access_token: null, refresh_token: null,
  });
  expect(dispatch).not.toHaveBeenCalled();
});

it("clears the new credentials and restores QR identity if policy persistence fails", async () => {
  AsyncStorage.setItem.mockRejectedValueOnce(new Error("synthetic policy disk failure"));
  await expect(complete()).rejects.toMatchObject({ code: "MOBILE_POLICY_UNAVAILABLE" });
  expect(await AsyncStorage.getItem("api_key")).toBe("old-fake-qr-key");
  expect(await AsyncStorage.getItem("employee_code")).toBe("OLD-FAKE-CODE");
  expect(await AsyncStorage.getItem("access_token")).toBeNull();
  expect(await AsyncStorage.getItem("refresh_token")).toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});

it("does not roll back over a newer QR provisioning when token persistence is cancelled", async () => {
  saveSpy.mockImplementationOnce(async () => {
    invalidateAuthSession();
    await AsyncStorage.multiSet([["api_key", "new-fake-qr-key"], ["employee_code", "NEW-FAKE-CODE"]]);
    throw new Error("synthetic newer session");
  });
  await expect(complete()).rejects.toThrow("synthetic newer session");
  expect(await AsyncStorage.getItem("api_key")).toBe("new-fake-qr-key");
  expect(await AsyncStorage.getItem("employee_code")).toBe("NEW-FAKE-CODE");
  expect(dispatch).not.toHaveBeenCalled();
});

it("retains a same-tenant attendance session, and clears it when tenants change", async () => {
  await AsyncStorage.setItem(SESSION_STATE_KEY, "fake-open-session");
  await complete();
  expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBe("fake-open-session");
  await AsyncStorage.setItem("baseUrl", "https://other.example.test");
  await complete();
  expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBeNull();
});

it("does not let an unread-count failure undo successful authentication", async () => {
  getNotifications.mockRejectedValue(new Error("fake-notification-failure"));
  await expect(complete()).resolves.toEqual({ status: "authenticated" });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "userAuth/setSignIn" }));
});

it("reuses a client per HTTPS tenant and rejects insecure lookup results", () => {
  expect(getMobileAuthClient(BASE_URL)).toBe(getMobileAuthClient(BASE_URL));
  expect(() => getMobileAuthClient("http://insecure.example.test")).toThrow(expect.objectContaining({ code: "INVALID_BASE_URL" }));
});

describe("SDK transport", () => {
  // Each test uses its own origin: clients, and their master tokens, are cached per origin.
  const replies = (handler) => expoFetch.mockImplementation(async (url) => {
    const [status, body] = handler(url);
    return { status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  });

  it("sends SDK requests through expo/fetch with redirects refused, cookies omitted and no-store", async () => {
    replies((url) => [200, url.endsWith("master_token") ? masterBody : policyBody()]);
    const flow = await getMobileAuthClient("https://transport-1.example.test").begin({ mobileNumber: " 5550001 " });
    expect(flow).toMatchObject({ action: "SIGN_IN", nextStep: "ENTER_PASSWORD", mobileNumber: "5550001" });
    const [url, init] = expoFetch.mock.calls[1];
    expect(url).toBe("https://transport-1.example.test/api/method/employee_app.authentication.get_employee_login_policy");
    expect(init).toMatchObject({ method: "POST", body: "mobile=5550001", redirect: "error", credentials: "omit" });
    expect(init.headers).toMatchObject({
      "Cache-Control": "no-store",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Bearer fake-master-token",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns HTTP failures as responses so the SDK classifies them", async () => {
    replies((url) => (url.endsWith("master_token") ? [200, masterBody] : [503, "<html>gateway</html>"]));
    await expect(getMobileAuthClient("https://transport-2.example.test").begin({ mobileNumber: "5550001" }))
      .rejects.toMatchObject({ code: "SERVER_ERROR", httpStatus: 503, retryable: true });
  });

  it("turns a refused redirect or dead socket into a cause-free NETWORK_ERROR", async () => {
    expoFetch.mockRejectedValue(new Error("Redirect is not allowed; Authorization: Bearer fake-master-token"));
    const error = await getMobileAuthClient("https://transport-3.example.test")
      .begin({ mobileNumber: "5550001" })
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("fake-master-token");
  });

  it("logs exact SDK exchanges in development with unredacted credentials", async () => {
    replies((url) => [200, url.endsWith("master_token") ? masterBody
      : url.endsWith("get_employee_login_policy") ? policyBody() : sdkSuccess()]);
    const auth = getMobileAuthClient("https://transport-5.example.test");
    const flow = await auth.begin({ mobileNumber: "5550001" });
    await auth.complete(flow, { password: "fake-password" });
    const logged = JSON.stringify(console.log.mock.calls);
    expect(logged).toContain("get_employee_login_policy");
    expect(logged).toContain("sign_in_policy");
    expect(logged).toContain("sign_in_api");
    for (const secret of ["fake-master-token", "fake-master-refresh", "fake-password", ACCESS, REFRESH]) {
      expect(logged).toContain(secret);
    }
    const request = console.log.mock.calls
      .filter(([label]) => label === "[auth-sdk] request")
      .map(([, payload]) => JSON.parse(payload))
      .find(({ url }) => url.endsWith("sign_in_api"));
    expect(request.headers.Authorization).toBe("Bearer fake-master-token");
    expect(request.form.password).toBe("fake-password");
    expect(request.body).toContain("password=fake-password");
    const response = console.log.mock.calls
      .filter(([label]) => label === "[auth-sdk] response")
      .map(([, payload]) => JSON.parse(payload))
      .find(({ url }) => url.endsWith("sign_in_api"));
    expect(JSON.parse(response.rawBody)).toEqual(sdkSuccess());
    expect(response.body.data.token.refresh_token).toBe(REFRESH);
    expect(response.requestId).toBe(request.requestId);
  });

  it("logs the supplied OTP and SDK-managed password exactly as transmitted", async () => {
    const success = sdkSuccess();
    success.data.password_policy = "No";
    success.data.otp_policy = "Mandatory";
    replies((url) => [200, url.endsWith("master_token") ? masterBody
      : url.endsWith("get_employee_login_policy") ? policyBody("No", "Mandatory") : success]);
    const auth = getMobileAuthClient("https://transport-otp-debug.example.test");
    const flow = await auth.begin({ mobileNumber: "5550001" });
    await auth.complete(flow, { otp: "123456" });
    const request = console.log.mock.calls
      .filter(([label]) => label === "[auth-sdk] request")
      .map(([, payload]) => JSON.parse(payload))
      .find(({ url }) => url.endsWith("sign_in_api"));
    expect(request.form.otp).toBe("123456");
    expect(request.form.password).toMatch(/^egf_[A-Za-z0-9]+$/);
    expect(new URLSearchParams(request.body).get("otp")).toBe("123456");
  });

  it("does not log SDK credentials in release builds", async () => {
    const previousDev = global.__DEV__;
    global.__DEV__ = false;
    try {
      replies((url) => [200, url.endsWith("master_token") ? masterBody
        : url.endsWith("get_employee_login_policy") ? policyBody() : sdkSuccess()]);
      const auth = getMobileAuthClient("https://transport-release-debug.example.test");
      const flow = await auth.begin({ mobileNumber: "5550001" });
      await auth.complete(flow, { password: "fake-password" });
      expect(console.log).not.toHaveBeenCalled();
    } finally {
      global.__DEV__ = previousDev;
    }
  });

  it("keeps authentication working when the debug console fails", async () => {
    console.log.mockImplementation(() => { throw new Error("synthetic console failure"); });
    replies((url) => [200, url.endsWith("master_token") ? masterBody : policyBody()]);
    await expect(getMobileAuthClient("https://transport-console-failure.example.test").begin({ mobileNumber: "5550001" }))
      .resolves.toMatchObject({ nextStep: "ENTER_PASSWORD" });
  });

  it("aborts at the client timeout and reports TIMEOUT", async () => {
    jest.useFakeTimers();
    try {
      expoFetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const pending = getMobileAuthClient("https://transport-4.example.test").begin({ mobileNumber: "5550001" });
      const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      await jest.advanceTimersByTimeAsync(15000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("hand-off diagnostics", () => {
  const payloads = label => console.log.mock.calls
    .filter(([event]) => event === `[mobile-auth] ${label}`)
    .map(([, payload]) => JSON.parse(payload));

  it("distinguishes successful OTP authentication from a failed employee-policy HTTP request", async () => {
    plainMock.resetHandlers();
    plainMock.onGet().reply(403, { message: "synthetic employee access denied", exception: "synthetic traceback" });
    const success = sdkSuccess();
    success.data.password_policy = "No";
    success.data.otp_policy = "Mandatory";
    await expect(complete({
      success, passwordPolicy: "No", otpPolicy: "Mandatory", credentials: { otp: "123456" },
    })).rejects.toMatchObject({ code: "MOBILE_POLICY_UNAVAILABLE" });
    expect(payloads("handoff.sdk.result")[0].completion.status).toBe("authenticated");
    expect(payloads("employee.request")[0]).toMatchObject({
      params: { employee_id: DOCNAME }, headers: { Authorization: `Bearer ${ACCESS}` }, timeoutMs: 10000,
    });
    expect(payloads("employee.failed")[0]).toMatchObject({
      status: 403, body: { message: "synthetic employee access denied", exception: "synthetic traceback" },
      error: { message: "Request failed with status code 403" },
    });
    expect(payloads("handoff.failed")[0]).toMatchObject({ stage: "employee.fetch", error: { code: "MOBILE_POLICY_UNAVAILABLE" } });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs the full identity response and the exact rejection reason without relaxing validation", async () => {
    plainMock.resetHandlers();
    plainMock.onGet().reply(200, { message: rawEmployee({ employee_code: undefined }) });
    await expect(complete()).rejects.toMatchObject({ code: "MOBILE_IDENTITY_UNVERIFIED" });
    expect(payloads("employee.response")[0].body.message.name).toBe(DOCNAME);
    expect(payloads("handoff.rejected")[0]).toMatchObject({
      code: "MOBILE_IDENTITY_UNVERIFIED", docnames: [DOCNAME], codes: [],
      reason: "Missing or conflicting employee document names or attendance identifiers",
    });
    expect(payloads("handoff.failed")[0].stage).toBe("employee.identity");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("logs policy validation's original error and the employee flags", async () => {
    plainMock.resetHandlers();
    plainMock.onGet().reply(200, { message: rawEmployee({ photo: undefined }) });
    await expect(complete()).rejects.toMatchObject({ code: "MOBILE_POLICY_UNAVAILABLE" });
    expect(payloads("employee.policy.invalid")[0]).toMatchObject({
      error: { message: "Attendance configuration is incomplete. Please contact your administrator." },
      employee: { restrict_location: 1, unrestricted_checkout_location: 0 },
    });
    expect(payloads("employee.policy.invalid")[0].error.stack).toContain("assertCompleteAttendancePolicy");
    expect(payloads("handoff.failed")[0].stage).toBe("employee.policy");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("logs token persistence failures and rollback without publishing login", async () => {
    saveSpy.mockRejectedValueOnce(new Error("synthetic disk failure"));
    await expect(complete()).rejects.toThrow("synthetic disk failure");
    expect(payloads("handoff.persistence.failed")[0]).toMatchObject({ stage: "tokens.save", error: { message: "synthetic disk failure" } });
    expect(payloads("handoff.rollback.end")).toHaveLength(1);
    expect(await AsyncStorage.getItem("api_key")).toBe("old-fake-qr-key");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

it("refuses mobile manual attendance when the restriction mirror is missing", async () => {
  await AsyncStorage.setItem("auth_method", "mobile");
  await AsyncStorage.setItem("access_token", ACCESS);
  await AsyncStorage.removeItem("restrict_location");
  const result = await userCheckIn({ employeeCode: EMPLOYEE_CODE, type: "IN" });
  expect(result.allowed).toBe(false);
  expect(result.message).toContain("Attendance configuration is unavailable");
});

it("does not mirror a partial later mobile location-policy response", async () => {
  await complete();
  const apiMock = new MockAdapter(apiClient.default);
  apiMock.onGet().reply(200, { message: {} });
  try {
    await expect(getOfficeLocation(EMPLOYEE_CODE)).rejects.toThrow("Attendance configuration is incomplete");
    expect(await AsyncStorage.getItem("restrict_location")).toBe("1");
  } finally {
    apiMock.restore();
  }
});

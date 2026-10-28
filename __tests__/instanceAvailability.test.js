import MockAdapter from "axios-mock-adapter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import apiClient, { clearTokens, plainAxios } from "../services/api/apiClient";
import {
  AVAILABLE_TTL_MS, checkInstanceAvailability, invalidateInstanceAvailability, SERVER_TIME_METHOD,
} from "../services/offline/InstanceAvailabilityService";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import * as Provenance from "../services/offline/attendanceQueueProvenance";
import { resetNetworkListener, startNetworkListener } from "../services/offline/NetworkListener";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const employee = "SYNTHETIC-EMPLOYEE";
const endpoint = tenant => `${tenant}/api/method/${SERVER_TIME_METHOD}`;
const body = { message: { server_time: "2026-10-27 09:59:46.123456" } };
let http;
let refresh;
let scope;
let logs;

beforeEach(async () => {
  logs = jest.spyOn(console, "log").mockImplementation(() => {});
  await clearTokens();
  await AsyncStorage.clear();
  await loginQueueEmployee(employee);
  scope = await captureAttendanceQueueScope(employee);
  invalidateInstanceAvailability();
  resetNetworkListener();
  NetInfo.fetch.mockResolvedValue({ type: "wifi", isConnected: true, isInternetReachable: true });
  http = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
});

afterEach(() => {
  http.restore();
  refresh.restore();
  resetNetworkListener();
  jest.restoreAllMocks();
});

it("validates the configured instance's clock contract and emits credential-free metadata", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  const result = await checkInstanceAvailability({ syncScope: scope });
  expect(result).toMatchObject({ status: "available", instanceId: TEST_TENANT, httpStatus: 200,
    cached: false, serverTime: body.message.server_time, observedAt: expect.any(Number), durationMs: expect.any(Number) });
  expect(JSON.stringify(result)).not.toContain("synthetic-access");
  const healthLogs = logs.mock.calls.filter(([prefix]) => String(prefix).startsWith("[InstanceHealth]"));
  expect(healthLogs).toHaveLength(1);
  expect(JSON.stringify(healthLogs)).not.toContain("synthetic-access");
  expect(http.history.post).toHaveLength(0);
});

it("skips the clock request when the device has no transport", async () => {
  NetInfo.fetch.mockResolvedValue({ type: "none", isConnected: false });
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "device_offline" });
  expect(http.history.get).toHaveLength(0);
});

it("tries the actual instance even when the OS internet probe is negative", async () => {
  NetInfo.fetch.mockResolvedValue({ type: "wifi", isConnected: true, isInternetReachable: false });
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  expect((await checkInstanceAvailability({ syncScope: scope })).status).toBe("available");
});

it("classifies a blocked host while Wi-Fi stays connected", async () => {
  http.onGet(endpoint(TEST_TENANT)).networkError();
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "instance_unreachable", failureCategory: "network", httpStatus: null });
});

it.each([["ENOTFOUND", "dns"], ["EAI_AGAIN", "dns"], ["ECONNREFUSED", "connection_refused"], ["ECONNABORTED", "timeout"], ["ETIMEDOUT", "timeout"]])(
  "classifies %s without leaking server messages", async (code, failureCategory) => {
    http.onGet(endpoint(TEST_TENANT)).reply(() => Promise.reject(Object.assign(new Error("synthetic-private-detail"), { code })));
    expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "instance_unreachable", failureCategory });
  },
);

it.each([500, 502, 503, 504])("classifies HTTP %s as server unavailable", async httpStatus => {
  http.onGet(endpoint(TEST_TENANT)).reply(httpStatus, {});
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "server_unavailable", failureCategory: "http_5xx", httpStatus });
});

it("classifies rate limiting and preserves Retry-After", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(429, {}, { "retry-after": "600" });
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "server_unavailable", failureCategory: "rate_limited", httpStatus: 429, retryAfterMs: 600000 });
});

it.each([404, 405, 501])("reports unsupported clock endpoint HTTP %s without calling the instance offline", async httpStatus => {
  http.onGet(endpoint(TEST_TENANT)).reply(httpStatus, {});
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "endpoint_unsupported", httpStatus });
});

it("recognizes an existing Frappe missing-method refusal as endpoint incompatibility", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(417, {
    exception: "Failed to get method for command employee_app.attendance_api.get_server_time with module has no attribute get_server_time",
  });
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({
    status: "endpoint_unsupported", failureCategory: "unsupported_endpoint", httpStatus: 417,
  });
});

it.each([{}, { message: "gateway" }, { message: { server_time: "2026-02-30 12:00:00" } },
  { message: { server_time: "2026-10-27 24:00:00" } }, { ...body, exc: "error" }])(
  "refuses an invalid HTTP-success clock response: %j", async invalid => {
    http.onGet(endpoint(TEST_TENANT)).reply(200, invalid);
    expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "configuration_error", failureCategory: "invalid_response", httpStatus: 200 });
  },
);

it("treats 403 as authentication/authorization trouble, without refresh or session deletion", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(403, {});
  expect(await checkInstanceAvailability({ syncScope: scope })).toMatchObject({ status: "authentication_required", httpStatus: 403 });
  expect(refresh.history.post).toHaveLength(0);
  expect(await AsyncStorage.getItem("access_token")).toBe("synthetic-access");
});

it("uses the existing 401 refresh-and-replay path", async () => {
  await AsyncStorage.setItem("refresh_token", "synthetic-refresh");
  http.onGet(endpoint(TEST_TENANT)).replyOnce(401);
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  refresh.onPost(`${TEST_TENANT}/api/method/employee_app.gauth.create_refresh_token`)
    .reply(200, { data: { access_token: "synthetic-rotated-access", refresh_token: "synthetic-rotated-refresh" } });
  expect((await checkInstanceAvailability({ syncScope: scope })).status).toBe("available");
  expect(refresh.history.post).toHaveLength(1);
  expect(http.history.get).toHaveLength(2);
  expect(await AsyncStorage.getItem("access_token")).toBe("synthetic-rotated-access");
});

it("deduplicates concurrent probes and briefly caches successful reads", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  const answers = await Promise.all([checkInstanceAvailability({ syncScope: scope }), checkInstanceAvailability({ syncScope: scope })]);
  expect(answers.every(answer => answer.status === "available")).toBe(true);
  expect(http.history.get).toHaveLength(1);
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(true);
  expect(http.history.get).toHaveLength(1);
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + AVAILABLE_TTL_MS + 1);
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(false);
  expect(http.history.get).toHaveLength(2);
});

it("expires failed results and detects recovery on the same Wi-Fi", async () => {
  http.onGet(endpoint(TEST_TENANT)).networkErrorOnce();
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  expect((await checkInstanceAvailability({ syncScope: scope })).status).toBe("instance_unreachable");
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(true);
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 1001);
  expect((await checkInstanceAvailability({ syncScope: scope })).status).toBe("available");
});

it("invalidates success on token rotation, network notifications and explicit failure", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  startNetworkListener();
  await checkInstanceAvailability({ syncScope: scope });
  await AsyncStorage.setItem("access_token", "synthetic-rotated-access");
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(false);
  const listener = NetInfo.addEventListener.mock.calls.at(-1)[0];
  listener({ type: "wifi", isConnected: true });
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(false);
  invalidateInstanceAvailability();
  expect((await checkInstanceAvailability({ syncScope: scope })).cached).toBe(false);
  expect(http.history.get).toHaveLength(4);
});

it("uses each tenant's configured domain, custom port and path", async () => {
  for (const tenant of ["https://alpha.example.com:8443/site", "https://beta.example.com:9443"]) {
    await loginQueueEmployee(employee, tenant);
    http.onGet(endpoint(tenant)).reply(200, body);
    expect(await checkInstanceAvailability()).toMatchObject({ status: "available", instanceId: tenant, cached: false });
  }
  expect(http.history.get.map(request => request.url)).toEqual([
    endpoint("https://alpha.example.com:8443/site"), endpoint("https://beta.example.com:9443"),
  ]);
});

it("never probes an arbitrary URL from supplied attendance scope", async () => {
  expect(await checkInstanceAvailability({ syncScope: { ...scope, tenantKey: "https://untrusted.example.com" } })).toMatchObject({ status: "stale_result" });
  expect(http.history.get).toHaveLength(0);
});

it("rejects an in-flight result after tenant switch without contaminating the next tenant", async () => {
  let release;
  let arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  http.onGet(endpoint(TEST_TENANT)).reply(() => new Promise(resolve => { release = resolve; arrived(); }));
  const previous = checkInstanceAvailability({ syncScope: scope });
  await started;
  const tenant = "https://next.example.com:8443";
  await loginQueueEmployee(employee, tenant);
  http.onGet(endpoint(tenant)).reply(200, body);
  expect((await checkInstanceAvailability()).status).toBe("available");
  release([200, body]);
  expect((await previous).status).toBe("stale_result");
  expect(await checkInstanceAvailability()).toMatchObject({ status: "available", instanceId: tenant, cached: true });
});

it("rejects a caller cancelled while its shared probe is running", async () => {
  let release;
  let arrived;
  let cancelled = false;
  const started = new Promise(resolve => { arrived = resolve; });
  http.onGet(endpoint(TEST_TENANT)).reply(() => new Promise(resolve => { release = resolve; arrived(); }));
  const pending = checkInstanceAvailability({ syncScope: { ...scope, isCancelled: () => cancelled } });
  await started;
  cancelled = true;
  release([200, body]);
  expect((await pending).status).toBe("cancelled");
});

it("bounds the complete health request even when the adapter never answers", async () => {
  let release;
  http.onGet(endpoint(TEST_TENANT)).reply(() => new Promise(resolve => { release = resolve; }));
  const started = Date.now();
  expect(await checkInstanceAvailability({ syncScope: scope, timeoutMs: 25 })).toMatchObject({ status: "instance_unreachable", failureCategory: "timeout" });
  expect(Date.now() - started).toBeLessThan(1000);
  release([200, body]);
});

it("bounds hanging transport discovery and never sends a late health request", async () => {
  let release;
  NetInfo.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  expect(await checkInstanceAvailability({ syncScope: scope, timeoutMs: 25 })).toMatchObject({ status: "instance_unreachable", failureCategory: "timeout" });
  release({ type: "wifi", isConnected: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(http.history.get).toHaveLength(0);
});

it("releases an expired shared probe when its final scope read stalls", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  const original = Provenance.assertAttendanceQueueScope;
  let stalled = false;
  let release;
  jest.spyOn(Provenance, "assertAttendanceQueueScope").mockImplementation(async expected => {
    const current = await original(expected);
    if (!stalled && http.history.get.length === 1) {
      stalled = true;
      return new Promise(resolve => { release = () => resolve(current); });
    }
    return current;
  });
  expect((await checkInstanceAvailability({ syncScope: scope, timeoutMs: 25 })).failureCategory).toBe("timeout");
  expect((await checkInstanceAvailability({ syncScope: scope, timeoutMs: 25 })).status).toBe("available");
  expect(http.history.get).toHaveLength(2);
  release();
  await Promise.resolve();
  expect(await checkInstanceAvailability({ syncScope: scope, timeoutMs: 25 })).toMatchObject({ status: "available", cached: true });
});

it("rejects cached authorization if the access token rotates during its final scope assertion", async () => {
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  await checkInstanceAvailability({ syncScope: scope });
  const original = Provenance.assertAttendanceQueueScope;
  let reads = 0;
  jest.spyOn(Provenance, "assertAttendanceQueueScope").mockImplementation(async expected => {
    reads += 1;
    if (reads === 3) await AsyncStorage.setItem("access_token", "synthetic-rotation-during-return");
    return original(expected);
  });
  // resolveCurrent, post-NetInfo and final cached assertion are the three reads.
  expect((await checkInstanceAvailability({ syncScope: scope })).status).toBe("stale_result");
  expect(http.history.get).toHaveLength(1);
});

it("bounds an in-progress token refresh without replaying a late health request", async () => {
  let release;
  await AsyncStorage.setItem("refresh_token", "synthetic-refresh");
  http.onGet(endpoint(TEST_TENANT)).replyOnce(401);
  http.onGet(endpoint(TEST_TENANT)).reply(200, body);
  refresh.onPost(`${TEST_TENANT}/api/method/employee_app.gauth.create_refresh_token`)
    .reply(() => new Promise(resolve => { release = resolve; }));
  expect(await checkInstanceAvailability({ syncScope: scope, timeoutMs: 30 })).toMatchObject({ status: "instance_unreachable", failureCategory: "timeout" });
  expect(refresh.history.post).toHaveLength(1);
  release([200, { data: { access_token: "synthetic-after-deadline", refresh_token: "synthetic-refresh-rotated" } }]);
  // Allow the existing refresh interceptor to finish its credential write. Its
  // replay carries the aborted signal and must not reach the HTTP adapter.
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(http.history.get).toHaveLength(1);
});

it("reports missing configuration separately from missing authentication", async () => {
  await AsyncStorage.removeItem("access_token");
  expect((await checkInstanceAvailability()).status).toBe("authentication_required");
  await AsyncStorage.setItem("baseUrl", "not a URL");
  expect((await checkInstanceAvailability()).status).toBe("configuration_error");
  expect(http.history.get).toHaveLength(0);
});

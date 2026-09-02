/**
 * sessionResilience.test.js
 *
 * The invariant these tests exist to defend:
 *
 *   A temporary inability to reach the server must NEVER destroy a valid
 *   employee session, and once an access token is refreshed every subsequent
 *   request must use the new one.
 *
 * The regressions being locked out are real and were shipped: a cumulative
 * count of transient refresh failures used to force a logout, and any 403 —
 * a permission error, a WAF rule, a rate limiter — used to be read as an
 * expired session.
 */

import MockAdapter from "axios-mock-adapter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient, {
  clearTokens,
  saveTokens,
  plainAxios,
  registerSessionCleanupHandler,
} from "../services/api/apiClient";
import { generateToken } from "../services/api/auth.service";
import {
  getAuthContext,
  clearAuthCache,
  MISSING_EMPLOYEE_MESSAGE,
} from "../services/api/authHelper";
import { getLeaveApplications } from "../services/api/leave.service";
import * as utils from "../services/api/utils";

jest.spyOn(utils, "cleanBaseUrl").mockImplementation((url) => url.trim());

const REFRESH_URL =
  "https://example.com/api/method/employee_app.gauth.create_refresh_token";
const API_URL = "https://example.com/api/data";

/** The three keys a QR provisioning writes. None may be lost to a logout. */
const provision = async () => {
  await AsyncStorage.multiSet([
    ["baseUrl", "https://example.com"],
    ["api_key", "API-KEY-1"],
    ["app_key", "APP-KEY-1"],
    ["employee_code", "TDI0071"],
  ]);
};

const storedTokens = async () => ({
  access: await AsyncStorage.getItem("access_token"),
  refresh: await AsyncStorage.getItem("refresh_token"),
});

describe("Session resilience", () => {
  let mock;
  let refreshMock;

  beforeEach(async () => {
    mock = new MockAdapter(apiClient);
    refreshMock = new MockAdapter(plainAxios);
    mock.reset();
    refreshMock.reset();

    // Resets hasTerminalSessionFailure and the in-memory token copies, so no
    // test inherits another's terminal state.
    await clearTokens();
    await AsyncStorage.clear();
    clearAuthCache();

    await provision();
    await AsyncStorage.multiSet([
      ["access_token", "OLD_TOKEN"],
      ["refresh_token", "REFRESH_1"],
    ]);
  });

  afterEach(() => {
    mock.reset();
    refreshMock.reset();
    registerSessionCleanupHandler(null);
  });

  // -------------------------------------------------------------------------
  // F1 — the refreshed token is the one every later request uses
  // -------------------------------------------------------------------------
  describe("F1 · a refreshed token is used by everything after it", () => {
    it("retries with the new token and keeps using it, without refreshing twice", async () => {
      const sent = [];

      mock.onGet(API_URL).reply((config) => {
        sent.push(config.headers.Authorization);
        // Only the very first attempt is unauthorised.
        return sent.length === 1 ? [401] : [200, { ok: true }];
      });

      refreshMock
        .onPost(REFRESH_URL)
        .reply(200, { data: { access_token: "NEW_TOKEN" } });

      await apiClient.get(API_URL);

      // A second, unrelated request some time later.
      await apiClient.get(API_URL);

      expect(sent[0]).toBe("Bearer OLD_TOKEN");
      expect(sent[1]).toBe("Bearer NEW_TOKEN"); // the retry
      expect(sent[2]).toBe("Bearer NEW_TOKEN"); // the next request
      expect(refreshMock.history.post).toHaveLength(1);
    });

    it("hands services the refreshed token, not the one cached at first use", async () => {
      // Populating the context first is what used to freeze the token: every
      // later caller — including the four fetch() attachment uploads, which no
      // interceptor can rescue — kept receiving this one.
      const before = await getAuthContext();
      expect(before.token).toBe("OLD_TOKEN");

      mock.onGet(API_URL).replyOnce(401);
      mock.onGet(API_URL).reply(200, { ok: true });
      refreshMock
        .onPost(REFRESH_URL)
        .reply(200, { data: { access_token: "NEW_TOKEN" } });

      await apiClient.get(API_URL);

      const after = await getAuthContext();
      expect(after.token).toBe("NEW_TOKEN");
    });

    it("reflects a changed employee rather than the one cached before logout", async () => {
      expect((await getAuthContext()).employeeCode).toBe("TDI0071");

      await AsyncStorage.setItem("employee_code", "TDI0099");

      expect((await getAuthContext()).employeeCode).toBe("TDI0099");
    });
  });

  // -------------------------------------------------------------------------
  // F2 — transport failures never end a session
  // -------------------------------------------------------------------------
  describe("F2 · network failure is not authentication failure", () => {
    it("keeps the session when the refresh times out", async () => {
      const cleanup = jest.fn();
      registerSessionCleanupHandler(cleanup);

      mock.onGet(API_URL).reply(401);
      refreshMock.onPost(REFRESH_URL).timeout();

      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      const tokens = await storedTokens();
      expect(tokens.access).toBe("OLD_TOKEN");
      expect(tokens.refresh).toBe("REFRESH_1");
      expect(cleanup).not.toHaveBeenCalled();
    });

    it("survives three transient failures of different kinds", async () => {
      const cleanup = jest.fn();
      registerSessionCleanupHandler(cleanup);

      mock.onGet(API_URL).reply(401);

      refreshMock.onPost(REFRESH_URL).timeout();
      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      refreshMock.reset();
      refreshMock.onPost(REFRESH_URL).reply(500);
      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      refreshMock.reset();
      refreshMock.onPost(REFRESH_URL).networkError();
      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      // The old behaviour destroyed the session on exactly this third failure.
      const tokens = await storedTokens();
      expect(tokens.access).toBe("OLD_TOKEN");
      expect(tokens.refresh).toBe("REFRESH_1");
      expect(cleanup).not.toHaveBeenCalled();
    });

    it("recovers when the connection comes back", async () => {
      mock.onGet(API_URL).replyOnce(401);
      refreshMock.onPost(REFRESH_URL).timeout();
      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      refreshMock.reset();
      refreshMock
        .onPost(REFRESH_URL)
        .reply(200, { data: { access_token: "NEW_TOKEN" } });

      mock.reset();
      mock.onGet(API_URL).replyOnce(401);
      mock.onGet(API_URL).reply((config) => {
        expect(config.headers.Authorization).toBe("Bearer NEW_TOKEN");
        return [200, { ok: true }];
      });

      const res = await apiClient.get(API_URL);

      expect(res.data.ok).toBe(true);
      expect((await storedTokens()).access).toBe("NEW_TOKEN");
    });

    it("keeps the session when a 5xx has no body at all", async () => {
      mock.onGet(API_URL).reply(401);
      refreshMock.onPost(REFRESH_URL).reply(503);

      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      expect((await storedTokens()).access).toBe("OLD_TOKEN");
    });
  });

  // -------------------------------------------------------------------------
  // F3 — 401 and 403 are different answers
  // -------------------------------------------------------------------------
  describe("F3 · 403 is authorisation, not expiry", () => {
    it("does not refresh or expire on a 403 from an ordinary endpoint", async () => {
      mock.onGet(API_URL).reply(403, {
        message: "Not permitted",
        exc_type: "PermissionError",
      });

      await expect(apiClient.get(API_URL)).rejects.toMatchObject({
        response: { status: 403 },
      });

      expect(refreshMock.history.post).toHaveLength(0);
      expect((await storedTokens()).access).toBe("OLD_TOKEN");
    });

    it("surfaces the server's own 403 message instead of 'Session expired'", async () => {
      mock
        .onGet(API_URL)
        .reply(403, { message: "You are not permitted to read Leave Application" });

      const error = await apiClient.get(API_URL).catch((err) => err);

      expect(error.message).not.toMatch(/session expired/i);
      expect(error.response.data.message).toMatch(/not permitted/i);
    });

    it("keeps the session when the refresh endpoint answers a generic 403", async () => {
      mock.onGet(API_URL).reply(401);
      // A rate limiter or WAF in front of the tenant — nothing to do with the
      // employee's credentials.
      refreshMock
        .onPost(REFRESH_URL)
        .reply(403, { message: "Too many requests from this address" });

      await expect(apiClient.get(API_URL)).rejects.toBeTruthy();

      const tokens = await storedTokens();
      expect(tokens.access).toBe("OLD_TOKEN");
      expect(tokens.refresh).toBe("REFRESH_1");
    });

    it("ends the session when a 403 names the refresh token as invalid", async () => {
      mock.onGet(API_URL).reply(401);
      refreshMock
        .onPost(REFRESH_URL)
        .reply(403, { message: "invalid_grant: refresh token expired" });

      await expect(apiClient.get(API_URL)).rejects.toThrow(/session expired/i);

      const tokens = await storedTokens();
      expect(tokens.access).toBeNull();
      expect(tokens.refresh).toBeNull();
    });

    it("ends the session when the refresh endpoint answers 401", async () => {
      mock.onGet(API_URL).reply(401);
      refreshMock.onPost(REFRESH_URL).reply(401, { message: "Invalid token" });

      await expect(apiClient.get(API_URL)).rejects.toThrow(/session expired/i);

      expect((await storedTokens()).access).toBeNull();
    });

    it("ends the session on an explicit AuthenticationError, whatever the status", async () => {
      mock.onGet(API_URL).reply(401);
      refreshMock
        .onPost(REFRESH_URL)
        .reply(417, { exc_type: "AuthenticationError" });

      await expect(apiClient.get(API_URL)).rejects.toThrow(/session expired/i);

      expect((await storedTokens()).access).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // F6 / logout semantics — what a forced expiry may and may not delete
  // -------------------------------------------------------------------------
  describe("Forced expiry keeps the tenant", () => {
    it("clears the session but leaves provisioning intact", async () => {
      mock.onGet(API_URL).reply(401);
      refreshMock.onPost(REFRESH_URL).reply(401);

      await expect(apiClient.get(API_URL)).rejects.toThrow(/session expired/i);

      // Gone: the session.
      expect(await AsyncStorage.getItem("access_token")).toBeNull();
      expect(await AsyncStorage.getItem("refresh_token")).toBeNull();

      // Kept: the tenant. This is what decides whether the employee is asked
      // for a password or sent back to the QR scanner.
      expect(await AsyncStorage.getItem("baseUrl")).toBe("https://example.com");
      expect(await AsyncStorage.getItem("api_key")).toBe("API-KEY-1");
      expect(await AsyncStorage.getItem("app_key")).toBe("APP-KEY-1");
    });
  });

  // -------------------------------------------------------------------------
  // F4 — a session is not created without the means to renew it
  // -------------------------------------------------------------------------
  describe("F4 · login requires a refresh token", () => {
    const LOGIN_URL =
      "https://example.com/api/method/employee_app.gauth.generate_token_secure";

    const login = () =>
      generateToken({
        api_key: "API-KEY-1",
        app_key: "APP-KEY-1",
        api_secret: "hunter2",
      });

    beforeEach(async () => {
      await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
      await clearTokens();
    });

    it("signs in when both tokens are returned", async () => {
      mock.onPost(LOGIN_URL).reply(200, {
        data: { access_token: "A_TOKEN", refresh_token: "R_TOKEN" },
      });

      await expect(login()).resolves.toMatchObject({
        access_token: "A_TOKEN",
        refresh_token: "R_TOKEN",
      });

      expect((await storedTokens()).refresh).toBe("R_TOKEN");
    });

    it("refuses a login with no refresh token and persists nothing", async () => {
      mock.onPost(LOGIN_URL).reply(200, { data: { access_token: "A_TOKEN" } });

      await expect(login()).rejects.toThrow(/refresh token/i);

      const tokens = await storedTokens();
      expect(tokens.access).toBeNull();
      expect(tokens.refresh).toBeNull();
    });

    it("never stores an empty-string refresh token", async () => {
      mock
        .onPost(LOGIN_URL)
        .reply(200, { data: { access_token: "A_TOKEN", refresh_token: "" } });

      await expect(login()).rejects.toThrow(/refresh token/i);

      expect((await storedTokens()).refresh).toBeNull();
    });

    it("refuses a login with no access token", async () => {
      mock.onPost(LOGIN_URL).reply(200, { data: { refresh_token: "R_TOKEN" } });

      await expect(login()).rejects.toThrow(/token not returned/i);

      expect((await storedTokens()).access).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // F5 — a missing employee is not an expired session
  // -------------------------------------------------------------------------
  describe("F5 · missing employee_code reports the real problem", () => {
    it("does not tell an authenticated employee their session expired", async () => {
      await AsyncStorage.removeItem("employee_code");

      const result = await getLeaveApplications();

      expect(result.error).toBe(MISSING_EMPLOYEE_MESSAGE);
      expect(result.error).not.toMatch(/session expired/i);
      expect(result.error).not.toMatch(/login again/i);

      // The session was never in question.
      expect((await storedTokens()).access).toBe("OLD_TOKEN");
    });

    it("still calls an expired session an expired session", async () => {
      await AsyncStorage.removeItem("access_token");
      await clearTokens();

      await expect(getAuthContext()).rejects.toThrow(/session expired/i);
    });
  });
});

/**
 * Refresh-token rotation.
 *
 * Confirmed with the backend on 2 Sep 2026: the access token lasts 3600s and
 * the refresh token never expires, but every refresh ISSUES A NEW ONE and
 * retires the token that was used. The stored refresh token is therefore the
 * session — there is no second way back into it short of the password.
 */
describe("Refresh-token rotation", () => {
  let mock;
  let refreshMock;

  beforeEach(async () => {
    mock = new MockAdapter(apiClient);
    refreshMock = new MockAdapter(plainAxios);
    mock.reset();
    refreshMock.reset();
    await clearTokens();
    await AsyncStorage.clear();
    await provision();
    await AsyncStorage.multiSet([
      ["access_token", "OLD_TOKEN"],
      ["refresh_token", "REFRESH_1"],
    ]);
  });

  afterEach(() => {
    mock.reset();
    refreshMock.reset();
    jest.restoreAllMocks();
  });

  it("stores the rotated refresh token, not the one it was issued for", async () => {
    mock.onGet(API_URL).replyOnce(401);
    mock.onGet(API_URL).reply(200, { ok: true });
    refreshMock.onPost(REFRESH_URL).reply(200, {
      data: { access_token: "NEW_TOKEN", refresh_token: "REFRESH_2" },
    });

    await apiClient.get(API_URL);

    const tokens = await storedTokens();
    expect(tokens.access).toBe("NEW_TOKEN");
    expect(tokens.refresh).toBe("REFRESH_2");
  });

  it("sends the rotated token on the next refresh, never the retired one", async () => {
    mock.onGet(API_URL).replyOnce(401);
    mock.onGet(API_URL).reply(200, { ok: true });
    refreshMock.onPost(REFRESH_URL).reply(200, {
      data: { access_token: "TOKEN_2", refresh_token: "REFRESH_2" },
    });
    await apiClient.get(API_URL);

    mock.reset();
    mock.onGet(API_URL).replyOnce(401);
    mock.onGet(API_URL).reply(200, { ok: true });
    refreshMock.reset();
    refreshMock.onPost(REFRESH_URL).reply(200, {
      data: { access_token: "TOKEN_3", refresh_token: "REFRESH_3" },
    });
    await apiClient.get(API_URL);

    expect(refreshMock.history.post[0].data).toContain("REFRESH_2");
    expect((await storedTokens()).refresh).toBe("REFRESH_3");
  });

  it("does not advance the in-memory token past what was durably stored", async () => {
    // A failed write used to leave memory holding the rotated token while disk
    // still held the retired one: this process kept working, and the NEXT
    // launch presented a token the server had already rotated away and was
    // refused. Memory must never run ahead of storage.
    const multiSet = jest
      .spyOn(AsyncStorage, "multiSet")
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(saveTokens("NEW_TOKEN", "REFRESH_2")).rejects.toThrow(
      /disk full/i,
    );
    multiSet.mockRestore();

    // Storage kept the working pair, and memory agrees with it.
    expect((await storedTokens()).refresh).toBe("REFRESH_1");

    let sentRefresh = null;
    mock.onGet(API_URL).replyOnce(401);
    mock.onGet(API_URL).reply(200, { ok: true });
    refreshMock.onPost(REFRESH_URL).reply((config) => {
      sentRefresh = config.data;
      return [200, { data: { access_token: "T2", refresh_token: "REFRESH_2" } }];
    });

    await apiClient.get(API_URL);

    expect(sentRefresh).toContain("REFRESH_1");
  });
});

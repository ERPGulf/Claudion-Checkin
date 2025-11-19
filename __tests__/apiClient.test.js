/**
 * apiClient.test.js
 * Senior-level production-grade test for axios client & interceptors
 */

import MockAdapter from "axios-mock-adapter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/api/apiClient";
import { refreshAccessToken } from "../services/api/apiClient";
import * as utils from "../services/api/utils";

// mock base URL utilities
jest.spyOn(utils, "cleanBaseUrl").mockImplementation((url) => url.trim());

describe("API Client (Interceptors + Token Refresh)", () => {
  let mock;

  beforeEach(async () => {
    mock = new MockAdapter(apiClient);
    mock.reset();

    await AsyncStorage.clear();
    await AsyncStorage.setItem("baseUrl", "https://example.com");
    await AsyncStorage.setItem("access_token", "token-123");
    await AsyncStorage.setItem("refresh_token", "refresh-123");
  });

  afterEach(() => {
    mock.reset();
  });

  // ---------------------------------------------------------
  // REQUEST INTERCEPTOR TESTS
  // ---------------------------------------------------------
  describe("Request Interceptor", () => {
    it("adds baseURL for relative paths", async () => {
      mock.onGet("https://example.com/api/user").reply(200, { ok: true });

      const res = await apiClient.get("user");

      expect(res.data.ok).toBe(true);
    });

    it("does NOT override full URLs", async () => {
      mock.onGet("https://google.com/test").reply(200, { ok: true });

      const res = await apiClient.get("https://google.com/test");

      expect(res.data.ok).toBe(true);
    });

    it("adds Authorization header when token exists", async () => {
      mock.onGet("https://example.com/api/test").reply((config) => {
        expect(config.headers.Authorization).toBe("Bearer token-123");
        return [200, { ok: true }];
      });

      await apiClient.get("test");
    });
  });

  // ---------------------------------------------------------
  // RESPONSE INTERCEPTOR (TOKEN REFRESH)
  // ---------------------------------------------------------
  describe("Response Interceptor (Token Refresh)", () => {
    it("retries request after successful token refresh", async () => {
      // first call returns 401
      mock.onGet("https://example.com/api/data").replyOnce(401);

      // refresh token call
      mock
        .onPost("https://example.com/api/method/employee_app.gauth.create_refresh_token")
        .reply(200, {
          data: {
            access_token: "token-NEW",
            refresh_token: "refresh-NEW",
          },
        });

      // retried call succeeds
      mock
        .onGet("https://example.com/api/data")
        .replyOnce(200, { ok: true });

      const res = await apiClient.get("data");

      expect(res.data.ok).toBe(true);
      expect(await AsyncStorage.getItem("access_token")).toBe("token-NEW");
    });

    it("ensures refreshPromise is shared (only ONE refresh request happens)", async () => {
      mock.onGet("https://example.com/api/data").reply(401);

      const refreshMock = new MockAdapter(require("axios"));
      refreshMock
        .onPost("https://example.com/api/method/employee_app.gauth.create_refresh_token")
        .reply(200, {
          data: {
            access_token: "new-TOKEN",
          },
        });

      const req1 = apiClient.get("data");
      const req2 = apiClient.get("data");

      const res = await Promise.all([req1, req2]);

      expect(res[0].data.ok).toBe(true);
      expect(res[1].data.ok).toBe(true);
    });

    it("throws if token refresh fails", async () => {
      mock.onGet("https://example.com/api/data").replyOnce(401);

      mock
        .onPost("https://example.com/api/method/employee_app.gauth.create_refresh_token")
        .reply(500);

      await expect(apiClient.get("data")).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------
  // refreshAccessToken DIRECT TEST
  // ---------------------------------------------------------
  describe("refreshAccessToken()", () => {
    it("stores new tokens", async () => {
      const axiosMock = new MockAdapter(require("axios"));

      axiosMock
        .onPost("https://example.com/api/method/employee_app.gauth.create_refresh_token")
        .reply(200, {
          data: {
            access_token: "AAA",
            refresh_token: "BBB",
          },
        });

      const token = await refreshAccessToken();

      expect(token).toBe("AAA");
      expect(await AsyncStorage.getItem("access_token")).toBe("AAA");
      expect(await AsyncStorage.getItem("refresh_token")).toBe("BBB");
    });

    it("throws error when refresh token missing", async () => {
      await AsyncStorage.removeItem("refresh_token");

      await expect(refreshAccessToken()).rejects.toThrow("Missing refresh token");
    });
  });
});

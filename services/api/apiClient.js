// src/services/api/apiClient.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl, setCommonHeaders } from "./utils";
import { store } from "../../redux/Store";
import { revertAll } from "../../redux/CommonActions";
import { setSignOut } from "../../redux/Slices/AuthSlice";

// ----------------------
// MEMORY TOKEN CACHE
// ----------------------
let memoryAccessToken = null;
let memoryRefreshToken = null;

const maskToken = (token) => {
  if (!token || typeof token !== "string") {
    return token ?? null;
  }

  if (token.length <= 10) {
    return `${token.slice(0, 3)}...${token.slice(-2)}`;
  }

  return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

const parseJsonString = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const extractServerMessages = (payload) => {
  const parsedPayload = parseJsonString(payload);
  const rawMessages = parsedPayload?._server_messages;
  const parsedMessages = parseJsonString(rawMessages);

  if (!Array.isArray(parsedMessages)) {
    return parsedMessages ?? null;
  }

  return parsedMessages.map((message) => parseJsonString(message));
};

const getDebugHeaders = (headers = {}) => {
  const authorization = headers?.Authorization ?? headers?.authorization;

  return {
    Authorization: authorization
      ? authorization.startsWith("Bearer ")
        ? `Bearer ${maskToken(authorization.replace(/^Bearer\s+/i, ""))}`
        : maskToken(authorization)
      : null,
    "Content-Type":
      headers?.["Content-Type"] ?? headers?.["content-type"] ?? null,
    "x-skip-auth": headers?.["x-skip-auth"] ?? headers?.["X-Skip-Auth"] ?? null,
  };
};

const getRequestDebugInfo = (config) => ({
  method: config?.method?.toUpperCase?.() ?? null,
  baseURL: config?.baseURL ?? null,
  url: config?.url ?? null,
  fullUrl:
    config?.baseURL && config?.url && !String(config.url).startsWith("http")
      ? `${config.baseURL}${config.url.startsWith("/") ? "" : "/"}${config.url}`
      : (config?.url ?? null),
  headers: getDebugHeaders(config?.headers),
  data:
    typeof config?.data === "string"
      ? config.data
      : config?.data instanceof URLSearchParams
        ? config.data.toString()
        : (config?.data ?? null),
  timeout: config?.timeout ?? null,
});

const getErrorDebugInfo = (err) => {
  const parsedResponseData = parseJsonString(err?.response?.data);
  const nestedData = parseJsonString(parsedResponseData?.data);

  return {
    status: err?.response?.status ?? null,
    message: err?.message ?? null,
    code: err?.code ?? null,
    request: getRequestDebugInfo(err?.config),
    responseData: parsedResponseData,
    nestedResponseData: nestedData,
    serverMessages: extractServerMessages(nestedData ?? parsedResponseData),
  };
};

const getTokenFromResponse = (payload, key) => {
  return (
    payload?.data?.[key] ?? payload?.message?.[key] ?? payload?.[key] ?? null
  );
};

async function loadTokens() {
  if (!memoryAccessToken) {
    memoryAccessToken = await AsyncStorage.getItem("access_token");
  }
  if (!memoryRefreshToken) {
    memoryRefreshToken = await AsyncStorage.getItem("refresh_token");
  }
  return { access: memoryAccessToken, refresh: memoryRefreshToken };
}

export async function saveTokens(access, refresh) {
  const nextAccess =
    access ?? memoryAccessToken ?? (await AsyncStorage.getItem("access_token"));
  const nextRefresh =
    refresh ??
    memoryRefreshToken ??
    (await AsyncStorage.getItem("refresh_token")) ??
    "";

  if (!nextAccess) {
    throw new Error("Access token missing");
  }

  memoryAccessToken = nextAccess;
  memoryRefreshToken = nextRefresh;
  hasTerminalSessionFailure = false;

  await AsyncStorage.multiSet([
    ["access_token", String(nextAccess)],
    ["refresh_token", String(nextRefresh)],
  ]);
}
export function clearStore() {
  store.dispatch(setSignOut());
  store.dispatch(revertAll());
}
export async function clearTokens() {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  hasTerminalSessionFailure = false;
  delete apiClient.defaults.headers.common.Authorization;
  await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
}

// ----------------------
// AXIOS CLIENTS
// ----------------------
const apiClient = axios.create({ timeout: 30000 });
export const plainAxios = axios.create({ timeout: 30000 });

// ----------------------
// REFRESH CONTROL
// ----------------------
let isRefreshing = false;
let refreshPromise = null;
let failedQueue = [];
let hasTerminalSessionFailure = false;

let refreshFailCount = 0;
const MAX_REFRESH_RETRIES = 3;
const SESSION_EXPIRED_MESSAGE = "Session expired. Please login again.";

const processQueue = (error, token = null) => {
  failedQueue.forEach((req) => {
    if (error) req.reject(error);
    else req.resolve(token);
  });
  failedQueue = [];
};

const createSessionExpiredError = () => new Error(SESSION_EXPIRED_MESSAGE);

const getRefreshErrorType = (err) => {
  const parsedResponseData = parseJsonString(err?.response?.data);
  const nestedData = parseJsonString(parsedResponseData?.data);

  return nestedData?.exc_type ?? parsedResponseData?.exc_type ?? null;
};

const isTerminalRefreshFailure = (err) => {
  const status = err?.response?.status;
  const errorType = getRefreshErrorType(err);

  return (
    status === 401 ||
    status === 403 ||
    errorType === "PermissionError" ||
    errorType === "AuthenticationError"
  );
};

const expireSession = async () => {
  hasTerminalSessionFailure = true;
  refreshFailCount = 0;
  memoryAccessToken = null;
  memoryRefreshToken = null;
  delete apiClient.defaults.headers.common.Authorization;
  await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
  clearStore();
};

// ----------------------
// REFRESH ACCESS TOKEN
// ----------------------
export const refreshAccessToken = async () => {
  const { refresh } = await loadTokens();
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");

  if (!refresh || !rawBaseUrl) {
    throw new Error("Missing refresh token or base URL");
  }

  const url = `${cleanBaseUrl(rawBaseUrl)}/api/method/employee_app.gauth.create_refresh_token`;

  const form = new URLSearchParams();
  form.append("refresh_token", refresh);

  console.log("refreshAccessToken start", {
    baseUrl: cleanBaseUrl(rawBaseUrl),
    url,
    refreshToken: maskToken(refresh),
    request: {
      headers: getDebugHeaders(setCommonHeaders()),
      data: form.toString(),
    },
  });

  try {
    const { data } = await plainAxios.post(url, form.toString(), {
      headers: setCommonHeaders(),
    });

    console.log("refreshAccessToken success", {
      url,
      responseKeys: Object.keys(data ?? {}),
      accessToken: maskToken(getTokenFromResponse(data, "access_token")),
      refreshToken: maskToken(
        getTokenFromResponse(data, "refresh_token") ?? refresh,
      ),
    });

    const newAccess = getTokenFromResponse(data, "access_token");
    const newRefresh = getTokenFromResponse(data, "refresh_token") ?? refresh;

    if (!newAccess) throw new Error("Refresh returned empty token");

    await saveTokens(newAccess, newRefresh);
    hasTerminalSessionFailure = false;

    // 🔥 FIX: update stale axios cache
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${newAccess}`;

    refreshFailCount = 0;

    return newAccess;
  } catch (err) {
    console.log("refreshAccessToken failed", {
      refreshToken: maskToken(refresh),
      ...getErrorDebugInfo(err),
    });

    if (isTerminalRefreshFailure(err)) {
      await expireSession();
      throw createSessionExpiredError();
    }

    refreshFailCount += 1;

    if (refreshFailCount >= MAX_REFRESH_RETRIES) {
      await expireSession();
      throw createSessionExpiredError();
    }

    throw err;
  }
};

// ----------------------
// REQUEST INTERCEPTOR
// ----------------------
apiClient.interceptors.request.use(async (config) => {
  const baseUrl = await AsyncStorage.getItem("baseUrl");

  // skip auth header logic (generateToken)
  if (config.headers?.["x-skip-auth"] === "true") {
    return config;
  }

  const { access } = await loadTokens();

  if (baseUrl && !config.url.startsWith("http")) {
    config.baseURL = `${cleanBaseUrl(baseUrl)}/api`;
  }

  if (access) {
    config.headers.Authorization = `Bearer ${access}`;
  }

  return config;
});

// ----------------------
// RESPONSE INTERCEPTOR
// ----------------------
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Skip refresh logic for generateToken()
    if (original.headers?.["x-skip-auth"] === "true") {
      return Promise.reject(error);
    }

    if (original._retry) {
      return Promise.reject(error);
    }

    const status = error?.response?.status;
    const isAuthError = status === 401 || status === 403;
    const isRefreshCall = original.url?.includes("create_refresh_token");

    if (isAuthError && hasTerminalSessionFailure) {
      console.log("Auth error after terminal session failure", {
        ...getErrorDebugInfo(error),
        refreshState: {
          isRefreshing,
          queueLength: failedQueue.length,
          refreshFailCount,
          hasTerminalSessionFailure,
        },
      });
      return Promise.reject(createSessionExpiredError());
    }

    // If refresh API itself failed → logout
    if (isAuthError && isRefreshCall) {
      console.log("Refresh endpoint auth failure", getErrorDebugInfo(error));
      await expireSession();
      return Promise.reject(createSessionExpiredError());
    }

    if (isAuthError) {
      console.log("Auth error detected, attempting refresh", {
        ...getErrorDebugInfo(error),
        tokens: {
          accessToken: maskToken(memoryAccessToken),
          refreshToken: maskToken(memoryRefreshToken),
        },
        refreshState: {
          isRefreshing,
          queueLength: failedQueue.length,
          refreshFailCount,
          hasTerminalSessionFailure,
        },
      });
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token) => {
              original.headers = {
                ...original.headers,
                Authorization: `Bearer ${token}`,
              };
              resolve(apiClient(original));
            },
            reject,
          });
        });
      }

      isRefreshing = true;

      refreshPromise = new Promise(async (resolve, reject) => {
        try {
          const newToken = await refreshAccessToken();
          processQueue(null, newToken);
          resolve(newToken);
        } catch (err) {
          processQueue(err, null);
          reject(err);
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      });

      const newToken = await refreshPromise;

      original.headers = {
        ...original.headers,
        Authorization: `Bearer ${newToken}`,
      };

      return apiClient(original);
    }

    return Promise.reject(error);
  },
);

export default apiClient;

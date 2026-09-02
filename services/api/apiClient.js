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

// ----------------------
// CREDENTIAL-CHANGE LISTENERS
// ----------------------
// A successful token change is the moment an auth failure elsewhere in the app
// might have become recoverable. The offline attendance queue parks such rows as
// `blocked` and needs to re-attempt them here rather than waiting hours for its
// own schedule — but this module must not import that one (it would close an
// apiClient → offline → apiClient cycle), so listeners register instead. Same
// shape as `registerSessionCleanupHandler` below.
const tokenChangeListeners = new Set();

export const addTokenChangeListener = (listener) => {
  tokenChangeListeners.add(listener);
  return () => tokenChangeListeners.delete(listener);
};

const notifyTokenChanged = () => {
  tokenChangeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.log("[apiClient] Token change listener failed:", error?.message);
    }
  });
};

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

  const changed = nextAccess !== memoryAccessToken;

  // Persist BEFORE updating memory, and never the other way round.
  //
  // The backend rotates refresh tokens: each refresh issues a new one and
  // retires the one that was used. That makes the stored refresh token the
  // session itself — lose it and there is no way back without the password.
  //
  // Writing memory first meant a failed `multiSet` left the two disagreeing:
  // this process carried on happily with the new token in memory, while disk
  // still held the retired one. The app worked until it was next launched, then
  // presented a refresh token the server had already rotated away, was refused,
  // and logged the employee out — hours later and with nothing connecting the
  // two events. Awaiting the write first means memory is only ever advanced
  // once the durable copy is safe.
  await AsyncStorage.multiSet([
    ["access_token", String(nextAccess)],
    ["refresh_token", String(nextRefresh)],
  ]);

  memoryAccessToken = nextAccess;
  memoryRefreshToken = nextRefresh;
  hasTerminalSessionFailure = false;

  // Only on an actual change of credential — `saveTokens` is also called to
  // rewrite the same token, and that changes nothing for anyone waiting.
  // Fire-and-forget: a listener must never be able to fail a token save.
  if (changed) notifyTokenChanged();
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
  await AsyncStorage.multiRemove([
    "access_token",
    "refresh_token",
    "fcm_token",
    "fcm_last_message_at",
  ]);
}

// ----------------------
// AXIOS CLIENTS
// ----------------------
const apiClient = axios.create({ timeout: 30000 });
export const plainAxios = axios.create({ timeout: 30000 });

// ----------------------
// SESSION CLEANUP HOOK
// ----------------------
// Optional async handler run during forced logout (expireSession) so non-API
// teardown (e.g. FCM token/topic cleanup) can mirror manual logout WITHOUT
// apiClient importing that module — this avoids an apiClient <-> fcm.service
// import cycle. App.js registers the handler at startup.
let sessionCleanupHandler = null;

export const registerSessionCleanupHandler = (handler) => {
  sessionCleanupHandler = typeof handler === "function" ? handler : null;
};

// ----------------------
// REFRESH CONTROL
// ----------------------
let isRefreshing = false;
let refreshPromise = null;
let failedQueue = [];
let hasTerminalSessionFailure = false;

/**
 * Consecutive failed refreshes. Diagnostics only.
 *
 * It used to be a logout trigger: three cumulative failures — timeouts, dropped
 * connections, 5xx, spread across a whole shift and never decaying — called
 * `expireSession()` and destroyed a valid session. Being unable to reach the
 * server is not the server rejecting the employee, and a phone in a lift, a
 * basement or a site with one bar must not cost someone their session. Nothing
 * reads this now except the log line that reports it.
 */
let consecutiveRefreshFailures = 0;
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

/**
 * Exception types that name the credential itself as the problem.
 *
 * `PermissionError` is deliberately absent: Frappe raises it for "you may not
 * read this doctype" on a perfectly valid session, and it carries no claim
 * about the refresh token.
 */
const TERMINAL_EXC_TYPES = new Set([
  "AuthenticationError",
  "InvalidAuthorizationToken",
  "InvalidAuthorizationHeader",
  "TokenExpiredError",
]);

/** Server wording that names the refresh credential as invalid. */
const INVALID_REFRESH_PATTERNS = [
  /invalid[_\s-]?grant/i,
  /invalid[^.]{0,30}token/i,
  /token[^.]{0,30}(expired|revoked|invalid|not found)/i,
  /refresh token[^.]{0,30}(missing|expired|revoked|invalid)/i,
];

const refreshErrorText = (err) => {
  const parsed = parseJsonString(err?.response?.data);
  const nested = parseJsonString(parsed?.data);

  return [
    typeof parsed === "string" ? parsed : null,
    parsed?.message,
    parsed?.error,
    parsed?.error_description,
    parsed?.exception,
    nested?.message,
    nested?.error,
    nested?.exception,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
};

/**
 * Did the server explicitly reject the refresh credential?
 *
 * Only a yes here may end the session. The rule this encodes:
 *
 *   NETWORK FAILURE != AUTHENTICATION FAILURE
 *
 * `401` is the server saying the credential was refused, and is terminal.
 * `403` is not: Frappe answers it for permission errors, and a reverse proxy,
 * WAF or rate limiter answers it for reasons that have nothing to do with the
 * employee at all. A 403 only ends the session when the body itself names the
 * token as invalid, expired or revoked. Everything else — no response at all, a
 * timeout, a 5xx, an unexplained 403 — is retryable and leaves the tokens
 * exactly where they are.
 */
const isTerminalRefreshFailure = (err) => {
  const status = err?.response?.status;

  // No response means the request never reached a server that had an opinion.
  if (!status) return false;

  if (status === 401) return true;

  if (TERMINAL_EXC_TYPES.has(getRefreshErrorType(err))) return true;

  if (status === 403) {
    const text = refreshErrorText(err);
    return INVALID_REFRESH_PATTERNS.some((pattern) => pattern.test(text));
  }

  return false;
};

const expireSession = async () => {
  hasTerminalSessionFailure = true;
  consecutiveRefreshFailures = 0;
  memoryAccessToken = null;
  memoryRefreshToken = null;
  delete apiClient.defaults.headers.common.Authorization;

  // Mirror manual logout: invalidate the FCM token and topic subscriptions on
  // forced logout too. Runs before the token/topic AsyncStorage removals so the
  // handler can still read stored topics. Failures must never block teardown.
  if (sessionCleanupHandler) {
    try {
      await sessionCleanupHandler();
    } catch {
      // Ignore cleanup failures; session teardown must always proceed.
    }
  }

  await AsyncStorage.multiRemove([
    "access_token",
    "refresh_token",
    "fcm_token",
    "fcm_last_message_at",
  ]);
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
    const rotatedRefresh = getTokenFromResponse(data, "refresh_token");
    const newRefresh = rotatedRefresh ?? refresh;

    // The backend rotates refresh tokens, so a response without one means we
    // are about to keep a credential the server has just retired — the next
    // refresh will be refused and the employee signed out, with the real cause
    // an hour in the past. Nothing can be done about it here (there is no other
    // token to fall back to), but it must not pass silently: this log is what
    // connects that logout to this moment.
    if (!rotatedRefresh) {
      console.log(
        "[apiClient] WARNING: refresh response carried no refresh_token; keeping the previous one, which the server may have already rotated",
        { responseKeys: Object.keys(data ?? {}) },
      );
    }

    if (!newAccess) throw new Error("Refresh returned empty token");

    await saveTokens(newAccess, newRefresh);
    hasTerminalSessionFailure = false;

    // 🔥 FIX: update stale axios cache
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${newAccess}`;

    consecutiveRefreshFailures = 0;

    return newAccess;
  } catch (err) {
    console.log("refreshAccessToken failed", {
      refreshToken: maskToken(refresh),
      ...getErrorDebugInfo(err),
    });

    // The ONLY path that ends a session: the server answered, and what it said
    // was that this refresh credential is no longer good.
    if (isTerminalRefreshFailure(err)) {
      await expireSession();
      throw createSessionExpiredError();
    }

    // Everything else is transient by definition — we could not reach the
    // server, or it failed in a way that says nothing about the credential.
    // The tokens stay exactly where they are, the session stays authenticated,
    // and the next 401 tries again. There is deliberately no attempt ceiling:
    // an attempt ceiling is how a bad afternoon of signal used to become a
    // logout.
    consecutiveRefreshFailures += 1;
    console.log(
      `[apiClient] Refresh unavailable (attempt ${consecutiveRefreshFailures} since last success); session kept`,
    );

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

    // 401 only. A 403 is an *authorisation* answer — this employee may not do
    // this — and refreshing the token cannot change it. Treating 403 as an
    // expiry turned "you don't have permission to view this" into "your session
    // has expired", and put the app on the refresh path for every WAF rule,
    // proxy block and rate limit in front of the tenant. A 403 now falls
    // through to the caller with the server's own message intact.
    const isAuthError = status === 401;
    const isRefreshCall = original.url?.includes("create_refresh_token");

    if (isAuthError && hasTerminalSessionFailure) {
      console.log("Auth error after terminal session failure", {
        ...getErrorDebugInfo(error),
        refreshState: {
          isRefreshing,
          queueLength: failedQueue.length,
          consecutiveRefreshFailures,
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
          consecutiveRefreshFailures,
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

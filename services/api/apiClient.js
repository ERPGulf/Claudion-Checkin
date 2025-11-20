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
  memoryAccessToken = access;
  memoryRefreshToken = refresh;

  await AsyncStorage.multiSet([
    ["access_token", access],
    ["refresh_token", refresh],
  ]);
}
export function clearStore() {
  store.dispatch(setSignOut());
  store.dispatch(revertAll());
}
export async function clearTokens() {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
}

// ----------------------
// AXIOS CLIENTS
// ----------------------
const apiClient = axios.create({ timeout: 30000 });
const plainAxios = axios.create({ timeout: 30000 });

// ----------------------
// REFRESH CONTROL
// ----------------------
let isRefreshing = false;
let refreshPromise = null;
let failedQueue = [];

let refreshFailCount = 0;
const MAX_REFRESH_RETRIES = 3;

const processQueue = (error, token = null) => {
  failedQueue.forEach((req) => {
    if (error) req.reject(error);
    else req.resolve(token);
  });
  failedQueue = [];
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

  try {
    const { data } = await plainAxios.post(url, form.toString(), {
      headers: setCommonHeaders(),
    });

    const newAccess = data?.data?.access_token;
    const newRefresh = data?.data?.refresh_token;

    if (!newAccess) throw new Error("Refresh returned empty token");

    await saveTokens(newAccess, newRefresh);

    // 🔥 FIX: update stale axios cache
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${newAccess}`;

    refreshFailCount = 0;

    return newAccess;
  } catch (err) {
    console.log("❌ Refresh token failed:", err?.response?.data || err);

    refreshFailCount += 1;

    if (refreshFailCount >= MAX_REFRESH_RETRIES) {
      await clearTokens();
      clearStore();
      refreshFailCount = 0;
      throw new Error("Too many failed refresh attempts. Logging out.");
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

    // If refresh API itself failed → logout
    if (isAuthError && isRefreshCall) {
      await clearTokens();
      return Promise.reject("Session expired. Please login again.");
    }

    if (isAuthError) {
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
  }
);

export default apiClient;

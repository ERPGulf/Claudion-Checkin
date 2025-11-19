// src/services/api/apiClient.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl, setCommonHeaders } from "./utils";

let refreshPromise = null;

const apiClient = axios.create({
  timeout: 30000,
});

// --- REFRESH TOKEN LOGIC ---
const plainAxios = axios.create({ timeout: 60000 });

export const refreshAccessToken = async () => {
  const refresh_token = await AsyncStorage.getItem("refresh_token");
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");

  if (!refresh_token || !rawBaseUrl) throw new Error("Missing refresh token");

  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const url = `${baseUrl}/api/method/employee_app.gauth.create_refresh_token`;

  const body = new URLSearchParams();
  body.append("refresh_token", refresh_token);

  const { data } = await plainAxios.post(url, body.toString(), {
    headers: setCommonHeaders(),
  });

  const accessToken = data?.data?.access_token;
  const newRefresh = data?.data?.refresh_token;

  await AsyncStorage.multiSet([
    ["access_token", accessToken],
    ["refresh_token", newRefresh],
  ]);

  return accessToken;
};

// --- REQUEST INTERCEPTOR ---
apiClient.interceptors.request.use(async (config) => {
  let baseUrl = await AsyncStorage.getItem("baseUrl");
  const token = await AsyncStorage.getItem("access_token");

  if (baseUrl && !config.url.startsWith("http")) {
    config.baseURL = `${cleanBaseUrl(baseUrl)}/api`;
  }

  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- RESPONSE INTERCEPTOR ---
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (
      error.response &&
      [401, 403].includes(error.response.status) &&
      !original._retry
    ) {
      original._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(original);
    }

    return Promise.reject(error);
  }
);

export default apiClient;

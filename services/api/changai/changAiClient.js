// changAiClient.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateChangAiToken } from "./changAiAuth.service";

const BASE_URL = "https://hyrin.erpgulf.com:7061";

const changAiClient = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 60000,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
});

let isRefreshing = false;
let refreshPromise = null;

changAiClient.interceptors.request.use(async (config) => {
  let token = await AsyncStorage.getItem("changai_access_token");

  if (!token) {
    token = await generateChangAiToken();
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// 🔥 Handle 401 (token expired)
changAiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error?.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const newToken = await generateChangAiToken();

        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return changAiClient(originalRequest);
        }
      } catch (err) {
        console.log("❌ Token refresh failed");
      }
    }

    return Promise.reject(error);
  }
);

export default changAiClient;
// src/services/api/auth.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

export const generateToken = async ({ api_key, app_key, api_secret }) => {
  try {
    let baseUrl = await AsyncStorage.getItem("baseUrl");
    if (!baseUrl)
      throw new Error("Base URL not found. Please scan QR code first.");

    baseUrl = cleanBaseUrl(baseUrl);

    const url = `${baseUrl}/api/method/employee_app.gauth.generate_token_secure`;

    const body = new URLSearchParams();
    body.append("api_key", api_key);
    body.append("app_key", app_key);
    body.append("api_secret", api_secret);

    const response = await apiClient.post(url, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log(response.data);
    const tokenData = response?.data?.data;
    const accessToken = tokenData?.access_token;
    const refreshToken = tokenData?.refresh_token;

    if (!accessToken) throw new Error("Token not returned from server");

    // Save both tokens
    await AsyncStorage.multiSet([
      ["access_token", accessToken],
      ["refresh_token", refreshToken || ""],
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  } catch (error) {
    console.error(
      "❌ generateToken error:",
      error.response?.data || error.message
    );
    throw error;
  }
};

export default {
  generateToken,
};

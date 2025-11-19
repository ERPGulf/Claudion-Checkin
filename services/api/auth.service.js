// src/services/api/auth.service.js
import apiClient from "./apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

export const generateToken = async ({ api_key, app_key, api_secret }) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);

  const url = `${baseUrl}/api/method/employee_app.gauth.generate_token_secure`;

  const body = new URLSearchParams();
  body.append("api_key", api_key);
  body.append("app_key", app_key);
  body.append("api_secret", api_secret);

  const res = await apiClient.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const { access_token, refresh_token } = res.data.data;

  await AsyncStorage.multiSet([
    ["access_token", access_token],
    ["refresh_token", refresh_token || ""]
  ]);

  return { access_token, refresh_token };
};

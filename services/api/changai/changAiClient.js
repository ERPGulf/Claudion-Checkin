import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateChangAiToken } from "./changAiAuth.service";

const changAiClient = axios.create({
  baseURL: "https://hyrin.erpgulf.com:7061/api",
  timeout: 30000,
});

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

export default changAiClient;

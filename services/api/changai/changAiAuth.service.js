// changAiAuth.service.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://hyrin.erpgulf.com:7061";

export const generateChangAiToken = async () => {
  try {
    const form = new URLSearchParams();
    form.append("api_key", "Administrator");
    form.append("api_secret", "Friday2000@T");
    form.append("app_key", "Q2hhbmdBSQ==");

    const response = await axios.post(
      `${BASE_URL}/api/method/changai.changai.api.v2.text2sql_pipeline_v2.generate_token_secure`,
      form.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const accessToken = response?.data?.data?.access_token;

    if (!accessToken) {
      throw new Error("Failed to generate ChangAI token");
    }

    await AsyncStorage.setItem("changai_access_token", accessToken);

    return accessToken;
  } catch (error) {
    console.log("❌ ChangAI token error:", error?.response?.data || error.message);
    throw error;
  }
};
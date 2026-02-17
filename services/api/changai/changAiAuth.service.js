import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_URL =
  "https://hyrin.erpgulf.com:7061/api/method/changai.changai.api.v2.text2sql_pipeline_v2.generate_token_secure";

export const generateChangAiToken = async () => {
  try {
    const form = new URLSearchParams();
    form.append("api_key", "Administrator");
    form.append("api_secret", "Friday2000@T");
    form.append("app_key", "Q2hhbmdBSQ==");

    const { data } = await axios.post(TOKEN_URL, form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const access = data?.data?.access_token;
    const refresh = data?.data?.refresh_token;

    if (!access) {
      throw new Error("Failed to generate ChangAI token");
    }

    await AsyncStorage.multiSet([
      ["changai_access_token", access],
      ["changai_refresh_token", refresh],
    ]);

    return access;
  } catch (err) {
    console.log("❌ ChangAI token error:", err?.response?.data || err.message);
    throw err;
  }
};

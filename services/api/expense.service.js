// src/services/api/expense.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * getExpenseClaims()
 */
export const getExpenseClaims = async () => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      throw new Error("Missing baseUrl or token in storage");
    }

    // Keep the double slash before "api" as original code did
    const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const url = `${baseUrl}//api/method/employee_app.attendance_api.get_expense_claims`;

    console.log("📡 Fetching expense claims from:", url);

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = response.data?.message || response.data;

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("❌ Error fetching expense claims:", error);
    throw error;
  }
};

/**
 * createExpenseClaim(claimData)
 */
export const createExpenseClaim = async (claimData) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");
    const employee = await AsyncStorage.getItem("employee_code");

    if (!baseUrl || !token || !employee)
      throw new Error("Missing base URL, token, or employee code");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;
    console.log("🔗 POST URL:", url);

    const formData = new FormData();
    formData.append("employee", employee);
    formData.append("expense_date", claimData.expense_date);
    formData.append("expense_type", claimData.expense_type);
    formData.append("amount", claimData.amount);
    formData.append("description", claimData.description || "");

    // single file handling
    if (
      claimData.file_url &&
      Array.isArray(claimData.file_url) &&
      claimData.file_url.length > 0 &&
      claimData.file_url[0].uri
    ) {
      const file = claimData.file_url[0];
      const fileName = file.name || "upload.jpg";

      let fileType;
      if (file.mimeType) {
        fileType = file.mimeType;
      } else if (fileName.endsWith(".png")) {
        fileType = "image/png";
      } else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
        fileType = "image/jpeg";
      } else {
        fileType = "application/octet-stream";
      }

      formData.append("file_name", {
        uri: file.uri,
        name: fileName,
        type: fileType,
      });
    }

    console.log("📤 Sending expense claim (with file if any):", url);

    const response = await apiClient.post(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "multipart/form-data",
      },
      transformRequest: (data) => data,
    });

    console.log("✅ Expense claim created:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error creating expense claim:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * userExpenseFileUpload(file, docname)
 */
export const userExpenseFileUpload = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (claim ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.type || "application/octet-stream",
    });
    formData.append("is_private", 0);
    formData.append("doctype", "Expense Claim");
    formData.append("docname", docname);
    formData.append("fieldname", "file_url");

    const response = await apiClient.post(
      `${baseUrl}/api/method/upload_file`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    console.log("✅ File uploaded:", response.data);
    return response.data;
  } catch (err) {
    console.error("❌ File upload failed:", err);
    throw err;
  }
};

export default {
  getExpenseClaims,
  createExpenseClaim,
  userExpenseFileUpload,
};

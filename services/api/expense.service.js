// src/services/api/expense.service.js
import apiClient from "./apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * getExpenseClaims()
 * Already implemented earlier
 */
export const getExpenseClaims = async () => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      throw new Error("Missing baseUrl or token in storage");
    }

    const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const url = `${baseUrl}//api/method/employee_app.attendance_api.get_expense_claims`;

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
 * createExpenseClaim()
 * NEW: Added from your screen file
 */
export const createExpenseClaim = async (claimData) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl?.trim()?.replace(/\/+$/, "");
    const token = await AsyncStorage.getItem("access_token");
    const employee = await AsyncStorage.getItem("employee_code");

    if (!baseUrl || !token || !employee)
      throw new Error("Missing base URL, token, or employee code");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;

    const formData = new FormData();
    formData.append("employee", employee);
    formData.append("expense_date", claimData.expense_date);
    formData.append("expense_type", claimData.expense_type);
    formData.append("amount", claimData.amount);
    formData.append("description", claimData.description || "");

    if (claimData.file_url && claimData.file_url.uri) {
      const file = claimData.file_url;
      const fileName = file.name || "receipt.jpg";
      const fileType =
        file.mimeType ||
        file.type ||
        `image/${fileName.split(".").pop()}`;

      formData.append("file", {
        uri: file.uri,
        name: fileName,
        type: fileType,
      });
    }

    const response = await apiClient.post(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "multipart/form-data",
      },
      transformRequest: (data) => data,
    });

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
 * userExpenseFileUpload()
 * (Already in the original split)
 */
export const userExpenseFileUpload = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (claim ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl?.trim().replace(/\/+$/, "");

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

    return response.data;
  } catch (error) {
    console.error("❌ File upload failed:", error);
    throw error;
  }
};

export default {
  getExpenseClaims,
  createExpenseClaim,
  userExpenseFileUpload,
};

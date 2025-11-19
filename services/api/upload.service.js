// src/services/api/upload.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * userFileUpload(file, docname)
 * keeps same name and signature
 */
export const userFileUpload = async (file, docname) => {
  try {
    if (!file || !file.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (check-in ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name || "userfile.png",
      type: file.type || "image/png",
    });
    formData.append("file_name", "qr");
    formData.append("doctype", "Employee Checkin");
    formData.append("docname", docname);

    console.log("📤 Uploading file with data:", {
      docname,
      fileName: file.name,
      uri: file.uri,
    });

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    console.log("✅ Upload API response:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Upload API Error:", error.message || error);
    throw new Error("Photo upload failed");
  }
};

/**
 * putUserFile(employeeCode)
 */
export const putUserFile = async (employeeCode) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);

    const { data } = await apiClient.put(url, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
    });

    return data;
  } catch (error) {
    console.error(
      "Error updating employee:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * userStatusPut(employeeCode, custom_in)
 */
export const userStatusPut = async (employeeCode, custom_in) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");
    if (!employeeCode) throw new Error("Employee code is required");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;
    console.log("🔗 PUT URL:", url);

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);
    formData.append("custom_in", String(custom_in));

    const { data } = await apiClient.put(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    console.log("✅ Response:", data);
    return data;
  } catch (error) {
    console.error(
      "❌ userStatusPut error:",
      error.response?.data || error.message
    );
    throw new Error("Something went wrong while updating employee status");
  }
};

export default {
  userFileUpload,
  putUserFile,
  userStatusPut,
};

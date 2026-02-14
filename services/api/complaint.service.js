import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * AUTH CONTEXT (same pattern as leave.service)
 */
const getAuthContext = async () => {
  const [rawBaseUrl, token, employeeCode] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_code"),
  ]);

  if (!rawBaseUrl || !token) {
    throw new Error("Session expired");
  }

  return {
    baseUrl: cleanBaseUrl(rawBaseUrl),
    token,
    employeeCode,
  };
};

const buildHeaders = (token, contentType = "application/json") => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": contentType,
});

/**
 * CREATE COMPLAINT
 */
export const createComplaint = async ({ date, message }) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_complaint`;

    const body = {
      employee: employeeCode,
      date,
      message,
    };

    const response = await apiClient.post(url, body, {
      headers: buildHeaders(token),
      timeout: 15000,
    });

    return { message: response.data };
  } catch (error) {
    console.error(
      "❌ Create complaint failed:",
      error?.response?.data || error.message,
    );

    return {
      error:
        error?.response?.data?.message ||
        "Unable to submit complaint. Please try again.",
    };
  }
};

/**
 * UPLOAD COMPLAINT ATTACHMENT
 */
export const uploadComplaintAttachment = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file");
    if (!docname) throw new Error("Missing docname");

    const { baseUrl, token } = await getAuthContext();

    const formData = new FormData();

    formData.append("file", {
      uri: file.uri,
      name: file.name || "complaint.png",
      type: file.type || "application/octet-stream",
    });

    formData.append("file_name", "complaint");
    formData.append("doctype", "Employee Complaint");
    formData.append("docname", String(docname));

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      formData,
      {
        headers: buildHeaders(token, "multipart/form-data"),
        transformRequest: (data) => data,
      },
    );

    return response.data;
  } catch (error) {
    console.error(
      "❌ Complaint attachment upload failed:",
      error?.response?.data || error.message,
    );

    throw error;
  }
};

export default {
  createComplaint,
  uploadComplaintAttachment,
};

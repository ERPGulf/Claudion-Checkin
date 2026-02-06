import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * Create Complaint
 */
export const createComplaint = async ({ date, message }) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = rawBaseUrl?.trim()?.replace(/\/+$/, "");
  const token = await AsyncStorage.getItem("access_token");
  const employee = await AsyncStorage.getItem("employee_code");

  if (!baseUrl || !token || !employee) {
    throw new Error("Missing base URL, token, or employee code");
  }

  const url = `${baseUrl}/api/method/employee_app.attendance_api.create_complaint`;

  try {
    const response = await apiClient.post(
      url,
      {
        employee,
        date,
        message,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 15000,
      },
    );
    return response.data;
  } catch (e) {
    console.log("AXIOS ERROR FULL:", e);
    console.log("AXIOS MESSAGE:", e.message);
    console.log("AXIOS RESPONSE:", e.response);
    throw e;
  }
};

/**
 * Upload Complaint Attachment
 */
export const uploadComplaintAttachment = async (file, docname) => {
  if (!file?.uri) throw new Error("Invalid file");
  if (!docname && docname !== 0) throw new Error("Missing docname");

  const [rawBaseUrl, token] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
  ]);

  const baseUrl = cleanBaseUrl(rawBaseUrl);

  const formData = new FormData();
  formData.append("file", {
    uri: file.uri,
    name: file.name || "complaint.png",
    type: file.type || "image/png",
  });

  formData.append("file_name", "complaint");
  formData.append("doctype", "Employee Complaint");
  formData.append("docname", String(docname)); 

  const response = await apiClient.post(
    `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "multipart/form-data",
      },
      transformRequest: (data) => data,
    },
  );

  return response.data;
};

export default {
  createComplaint,
  uploadComplaintAttachment,
};

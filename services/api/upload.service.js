// src/services/api/upload.service.js
import apiClient from "./apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

export const uploadCheckinFile = async (file, docname) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const token = await AsyncStorage.getItem("access_token");

  const baseUrl = cleanBaseUrl(rawBaseUrl);

  const formData = new FormData();
  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.type,
  });

  formData.append("doctype", "Employee Checkin");
  formData.append("docname", docname);
  formData.append("file_name", "qr");

  return apiClient.post(
    `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
    formData,
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
  );
};

// src/services/api/upload.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { assertAttendanceQueueScope } from "../offline/attendanceQueueProvenance";
import { assertCapability } from "../capabilityPolicy";

/**
 * userFileUpload(file, docname)
 * keeps same name and signature
 */
export const userFileUpload = async (file, docname, { syncScope = null } = {}) => {
  try {
    if (!file || !file.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (check-in ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const capabilityScope = await assertCapability("attendance_action.photo_upload", { baseUrl });

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name || "userfile.png",
      type: file.type || "image/png",
    });
    formData.append("file_name", "qr");
    formData.append("doctype", "Employee Checkin");
    formData.append("docname", docname);

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      formData,
      {
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
        capabilityScope,
        requiredCapability: "attendance_action.photo_upload",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return response.data;
  } catch (error) {
    throw new Error("Photo upload failed");
  }
};

/**
 * putUserFile(employeeCode)
 */
export const putUserFile = async (employeeCode, _docname, { syncScope = null } = {}) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const capabilityScope = await assertCapability("attendance_action.photo_upload", {
      baseUrl,
      ...(typeof employeeCode === "string" ? { employeeCode } : {}),
    });

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);

    const { data } = await apiClient.put(url, formData, {
      ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
      capabilityScope,
      requiredCapability: "attendance_action.photo_upload",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
    });

    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * userStatusPut(employeeCode, custom_in)
 */
export const userStatusPut = async (employeeCode, custom_in, { syncScope = null } = {}) => {
  try {
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");
    if (!employeeCode) throw new Error("Employee code is required");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);
    formData.append("custom_in", String(custom_in));

    const { data } = await apiClient.put(url, formData.toString(), {
      ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    if (syncScope) await assertAttendanceQueueScope(syncScope);

    return data;
  } catch (error) {
    if (error?.code === "ATTENDANCE_SYNC_SCOPE_CHANGED") throw error;
    throw new Error("Something went wrong while updating employee status");
  }
};

export default {
  userFileUpload,
  putUserFile,
  userStatusPut,
};

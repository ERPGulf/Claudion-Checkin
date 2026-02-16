// src/services/api/leave.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { Platform } from "react-native";
import axios from "axios";
import { getAuthContext, buildHeaders } from "./authHelper";
import { parseError } from "./errorHelper";



export const createLeaveApplication = async (leaveData) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_leave_application`;

    const params = new URLSearchParams({
      employee: employeeCode,
      posting_date: leaveData.posting_date,
      leave_type: leaveData.leave_type,
      from_date: leaveData.from_date,
      to_date: leaveData.to_date,
      reason: leaveData.reason,
    });

    if (leaveData.leave_type === "Remote") {
      params.append("acknowledgement_policy", "1");
    }

    const response = await apiClient.post(url, params.toString(), {
      headers: buildHeaders(token, "application/x-www-form-urlencoded"),
    });

    return { message: response.data };
  } catch (error) {
    return { error: parseError(error, "Server error. Please try again later.") };
  }
};


export const getLeaveTypes = async () => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Missing credentials." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_leave_type`;

    const body = new URLSearchParams({ employee: employeeCode });

    const response = await apiClient.post(url, body.toString(), {
      headers: buildHeaders(token, "application/x-www-form-urlencoded"),
    });

    if (!Array.isArray(response.data?.message)) {
      return { error: "Invalid leave type response" };
    }

    return { message: response.data.message };
  } catch (error) {
    return { error: parseError(error, "Unable to load leave types.") };
  }
};



export const uploadLeaveAttachment = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (leave ID)");

    const { baseUrl, token } = await getAuthContext();

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name || "leave_attachment.jpg",
      type: file.type || "application/octet-stream",
    });
    formData.append("file_name", "leave");
    formData.append("doctype", "Leave Application");
    formData.append("docname", String(docname));

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      formData,
      {
        headers: buildHeaders(token, "multipart/form-data"),
        transformRequest: (data) => data,
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      "❌ Leave attachment upload failed:",
      error?.response?.data || error.message
    );
    throw error;
  }
};



export default {
  createLeaveApplication,
  getLeaveTypes,
  uploadLeaveAttachment,
};

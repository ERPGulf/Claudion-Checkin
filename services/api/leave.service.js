// src/services/api/leave.service.js
import apiClient from "./apiClient";
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
    const status = error?.response?.status;

    if (status === 500) {
      const backendError = error?.response?.data?.error;

      return {
        error: backendError || "Unable to create leave application.",
      };
    }

    return {
      error: parseError(error, "Server error. Please try again later."),
    };
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
    if (!docname) throw new Error("Missing docname");

    const { baseUrl, token } = await getAuthContext();

    const formData = new FormData();

    const getSafeFileName = (name) => {
      if (!name) return "file.pdf";

      const ext = name.split(".").pop();

      const base = name
        .replace(/\.[^/.]+$/, "")
        .slice(0, 20)
        .replace(/[^a-zA-Z0-9]/g, "");

      return `${base}_${Date.now()}.${ext}`;
    };

    const safeName = getSafeFileName(file.name);

    formData.append("file", {
      uri: file.uri,
      name: safeName,
      type: file.type || "application/octet-stream",
    });

    formData.append("file_name", safeName);
    formData.append("doctype", "Leave Application");
    formData.append("docname", String(docname));

    const response = await fetch(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      },
    );

    const result = await response.json();

    console.log(" LEAVE UPLOAD RESPONSE:", result);

    if (!response.ok || result?.exc || result?._server_messages) {
      return {
        error: result?.message || "Upload failed (server validation error)",
      };
    }

    return { message: result };
  } catch (error) {
    console.log("❌ LEAVE UPLOAD ERROR:", error);

    return {
      error: error.message || "Upload failed",
    };
  }
};
export default {
  createLeaveApplication,
  getLeaveTypes,
  uploadLeaveAttachment,
};

import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { getServerTime } from "./attendance.service";

/**
 * CREATE COMPLAINT
 */
export const createComplaint = async ({ message }) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    // 🔥 Get accurate server time
    const serverTime = await getServerTime();

    if (!serverTime) {
      return { error: "Unable to fetch server time." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_complaint`;

    const body = {
      employee: employeeCode,
      date: serverTime, 
      message,
    };

    const response = await apiClient.post(url, body, {
      headers: buildHeaders(token),
      timeout: 15000,
    });

    return { message: response.data };
  } catch (error) {
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
    formData.append("doctype", "Employee Complaint");
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

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("Invalid server response");
    }

    if (!response.ok) {
      console.log("❌ UPLOAD FAILED:", result);
      throw new Error(result?.message || "Upload failed");
    }

    console.log("✅ COMPLAINT UPLOAD RESPONSE:", result);

    return result;
  } catch (error) {
    console.log("❌ COMPLAINT UPLOAD ERROR:", error);
    throw error;
  }
};
export default {
  createComplaint,
  uploadComplaintAttachment,
};

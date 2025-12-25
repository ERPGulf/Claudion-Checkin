// src/services/api/leave.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * createLeaveApplication(leaveData)
 */
export const createLeaveApplication = async (leaveData) => {
  try {
    const [rawBaseUrl, token, employeeCode] = await Promise.all([
      AsyncStorage.getItem("baseUrl"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("employee_code"),
    ]);

    if (!rawBaseUrl || !token || !employeeCode) {
      let missingMessage;

      if (!rawBaseUrl) {
        missingMessage = "Base URL not found. Please scan QR code first.";
      } else if (!token) {
        missingMessage = "Access token missing. Please log in again.";
      } else {
        missingMessage = "Employee code missing. Please scan QR code again.";
      }

      return { error: missingMessage };
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_leave_application`;

    const formatDate = (date) => {
      if (!date) return "";
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const remoteAgreementText = `I acknowledge and agree to the proposed remote work arrangement.
I will fulfill all my job responsibilities while working remotely and maintain regular communication with my team and supervisors.
I confirm that I possess the necessary equipment and technology required to perform my job remotely.
I agree to maintain the confidentiality of all company information.
I understand the employer may require me to return to the office if needed.
The employer reserves the right to approve or deny the leave request based on business needs.`;

    const formData = new URLSearchParams();
    formData.append("employee", employeeCode);
    formData.append("posting_date", formatDate(leaveData.posting_date));
    formData.append("leave_type", leaveData.leave_type);
    formData.append("from_date", formatDate(leaveData.from_date));
    formData.append("to_date", formatDate(leaveData.to_date));
    formData.append("reason", leaveData.reason || "N/A");

    if (
      leaveData.leave_type === "Remote" &&
      leaveData.acknowledgement_policy === 1
    ) {
      formData.append("acknowledgement_policy", "1");
      formData.append("agreement", remoteAgreementText);
    }

    const response = await apiClient.post(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    console.error("❌ Error creating leave application:", error);
    return { error: error.message || "Something went wrong" };
  }
};
// getLeaveTypes()

export const getLeaveTypes = async () => {
  try {
    const [rawBaseUrl, token, employeeCode] = await Promise.all([
      AsyncStorage.getItem("baseUrl"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("employee_code"),
    ]);

    if (!rawBaseUrl || !token || !employeeCode) {
      return { error: "Base URL, token or employee missing." };
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_leave_type`;

    const formData = new URLSearchParams();
    formData.append("employee", employeeCode);

    const response = await apiClient.post(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    console.log("🔥 Leave type error:", error.response?.data || error.message);
    return { error: "Unable to load leave types." };
  }
};

export default {
  createLeaveApplication,
  getLeaveTypes,
};

// src/services/api/expense.service.js

import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { parseError } from "./errorHelper";
/**
 * Get Expense Claims
 */
export const getExpenseClaims = async () => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_expense_claims`;

    const response = await apiClient.get(url, {
      headers: buildHeaders(token),
    });

    if (!Array.isArray(response.data?.message)) {
      return { error: "Invalid expense claim response." };
    }

    return { message: response.data.message };
  } catch (error) {
    return {
      error: parseError(error, "Unable to load expense claims."),
    };
  }
};
/**
 * Get Expense Types
 */
export const getExpenseTypes = async () => {
  try {
    const { baseUrl, token } = await getAuthContext();

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_expense_claim_type`;

    const response = await apiClient.get(url, {
      headers: buildHeaders(token),
    });

    if (!Array.isArray(response.data?.message)) {
      return { error: "Invalid expense type response." };
    }

    return { message: response.data.message };
  } catch (error) {
    return {
      error: parseError(error, "Unable to load expense types."),
    };
  }
};

/**
 * Create Expense Claim
 */
export const createExpenseClaim = async (claimData) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;

    const formData = new FormData();

    formData.append("employee", employeeCode);
    formData.append("expense_date", claimData.expense_date);
    formData.append("expense_type", claimData.expense_type);
    formData.append("amount", claimData.amount);
    formData.append("description", claimData.description || "");

    if (claimData.file_url?.uri) {
      formData.append("file", {
        uri: claimData.file_url.uri,
        name: claimData.file_url.name || "receipt.jpg",
        type:
          claimData.file_url.type ||
          claimData.file_url.mimeType ||
          "application/octet-stream",
      });
    }

    const response = await apiClient.post(url, formData, {
      headers: buildHeaders(token, "multipart/form-data"),
      transformRequest: (data) => data,
    });

    return { message: response.data?.message || response.data };
  } catch (error) {
    return {
      error: parseError(error, "Unable to create expense claim."),
    };
  }
};

/**
 * Upload Expense File
 */
export const uploadExpenseAttachment = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (claim ID)");

    const { baseUrl, token } = await getAuthContext();

    const formData = new FormData();

    formData.append("file", {
      uri: file.uri,
      name: file.name || "expense_receipt.jpg",
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
        headers: buildHeaders(token, "multipart/form-data"),
        transformRequest: (data) => data,
      },
    );

    return { message: response.data };
  } catch (error) {
    return {
      error: parseError(error, "Failed to upload expense attachment."),
    };
  }
};

export default {
  getExpenseClaims,
  getExpenseTypes,
  createExpenseClaim,
  uploadExpenseAttachment,
};

// src/services/api/expense.service.js

import apiClient from "./apiClient";
import {
  getAuthContext,
  buildHeaders,
  MISSING_EMPLOYEE_MESSAGE,
} from "./authHelper";
import { parseError } from "./errorHelper";
import { assertCapability } from "../capabilityPolicy";
/**
 * Get Expense Claims
 */
export const getExpenseClaims = async () => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: MISSING_EMPLOYEE_MESSAGE };
    }

    const capabilityScope = await assertCapability("expense_claim", { baseUrl, employeeCode });

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_expense_claims`;

    const response = await apiClient.get(url, {
      capabilityScope,
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
    const capabilityScope = await assertCapability("expense_claim", { baseUrl });

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_expense_claim_type`;

    const response = await apiClient.get(url, {
      capabilityScope,
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
export const createExpenseClaim = async (claimData, { capabilityScope: expected } = {}) => {
  try {
    const owner = expected ? await assertCapability("expense_claim", expected) : null;
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: MISSING_EMPLOYEE_MESSAGE };
    }

    const capabilityScope = await assertCapability("expense_claim", { ...owner, baseUrl, employeeCode });

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;

    const payload = {
      employee: employeeCode,
      expense_date: claimData.expense_date,
      expense_type: claimData.expense_type,
      amount: claimData.amount,
      description: claimData.description || "",
    };

    const response = await apiClient.post(url, payload, {
      capabilityScope,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json", 
      },
      timeout: 60000,
    });

    return response.data;
  } catch (error) {
    console.log("CREATE ERROR:", { code: error?.code, httpStatus: error?.response?.status });

    return {
      error: parseError(error, "Unable to create expense claim."),
    };
  }
};

/**
 * Upload Expense File
 */
export const uploadExpenseAttachment = async (file, docname, { capabilityScope: expected } = {}) => {
  try {

    const owner = expected ? await assertCapability("expense_claim", expected) : null;

    if (!file?.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname");

    const { baseUrl, token } = await getAuthContext();
    const capabilityScope = await assertCapability("expense_claim", { ...owner, baseUrl });

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
    formData.append("doctype", "Expense Claim");
    formData.append("docname", docname);

    await assertCapability("expense_claim", capabilityScope);
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
      console.log("❌ UPLOAD FAILED:", { httpStatus: response.status });
      throw new Error(result?.message || "Upload failed");
    }

    return { message: result };
  } catch (error) {
    console.log("❌ UPLOAD ERROR:", { code: error?.code, httpStatus: error?.response?.status });

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

// src/services/api/salaryAdvance.service.js

import apiClient from "./apiClient";
import {
  getAuthContext,
  buildHeaders,
  MISSING_EMPLOYEE_MESSAGE,
} from "./authHelper";
import { parseError } from "./errorHelper";

export const SalaryAdvanceRequest = async (advanceData) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: MISSING_EMPLOYEE_MESSAGE };
    }

    const url = `${baseUrl}/api/method/employee_app.gauth.salary_advance_request`;

    const params = new URLSearchParams({
      employee: employeeCode,
      amount: String(advanceData.amount),
      date: advanceData.date,
      reason: advanceData.purpose,
    });

    const response = await apiClient.post(url, params.toString(), {
      headers: buildHeaders(token, "application/x-www-form-urlencoded"),
    });

    return {
      message: response.data,
    };
  } catch (error) {
    const status = error?.response?.status;

    if (status === 500) {
      const backendError = error?.response?.data?.error;

      return {
        error: backendError || "Unable to submit salary advance request.",
      };
    }

    return {
      error: parseError(error, "Server error. Please try again later."),
    };
  }
};


export default {
  SalaryAdvanceRequest,
  
};

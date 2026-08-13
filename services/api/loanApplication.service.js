import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { parseError } from "./errorHelper";
import { sanitizeAttachment } from "../../utils/fileName";

/* ===========================
   Get Loan Products
=========================== */
export const getLoanProducts = async () => {
  try {
    const { baseUrl, token } = await getAuthContext();

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_loan_product`;

    const response = await apiClient.post(
      url,
      {},
      {
        headers: buildHeaders(token),
      },
    );

    const payload = response.data;

    if (Array.isArray(payload)) return payload;

    return payload?.message || payload?.data || [];
  } catch (error) {
    console.log("Loan Products Error:", error.response?.data || error);

    throw new Error(parseError(error, "Unable to fetch loan products."));
  }
};

/* ===========================
   Create Loan Application
=========================== */
export const LoanApplicationRequest = async (loanData) => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      throw new Error("Session expired. Please login again.");
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_loan_application`;

    const formData = new FormData();

    formData.append("employee", employeeCode);
    formData.append("product_name", loanData.product_name);
    formData.append("amount", String(loanData.amount));
    formData.append("reason", loanData.reason);

    if (
      loanData.repayment_amount !== undefined &&
      loanData.repayment_amount !== null
    ) {
      formData.append("repayment_amount", String(loanData.repayment_amount));
    }

    if (loanData.repayment_method) {
      formData.append("repayment_method", loanData.repayment_method);
    }

    const file1 = sanitizeAttachment(loanData.file1, "attachment-1");

    const file2 = sanitizeAttachment(loanData.file2, "attachment-2");

    if (file1) {
      formData.append("file1", {
        uri: file1.uri,
        name: file1.name,
        type: file1.type,
      });
    }

    if (file2) {
      formData.append("file 2", {
        uri: file2.uri,
        name: file2.name,
        type: file2.type,
      });
    }

    console.log("Loan Request URL:", url);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const responseText = await response.text();

    console.log("Loan HTTP Status:", response.status);
    console.log("Loan Response:", responseText);

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("Invalid response from server.");
    }

    if (!response.ok) {
      throw new Error(
        data?.message || `Loan request failed with status ${response.status}`,
      );
    }

    if (data?.status === "error") {
      throw new Error(data?.message || "Loan application failed.");
    }

    return data;
  } catch (error) {
    console.log("Loan Application Error:", error);

    throw new Error(error?.message || "Unable to submit loan application.");
  }
};
export default {
  getLoanProducts,
  LoanApplicationRequest,
};

import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { parseError } from "./errorHelper";

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

    // ===========================
    // Repayment Details
    // ===========================

    if (
      loanData.repayment_amount !== undefined &&
      loanData.repayment_amount !== null
    ) {
      formData.append("repayment_amount", String(loanData.repayment_amount));
    }

    if (loanData.repayment_method) {
      formData.append("repayment_method", loanData.repayment_method);
    }

    // ===========================
    // File 1
    // ===========================

    if (loanData.file1) {
      formData.append("file1", {
        uri: loanData.file1.uri,
        name: loanData.file1.name,
        type: loanData.file1.mimeType || "application/octet-stream",
      });
    }

    // ===========================
    // File 2
    // ===========================

    if (loanData.file2) {
      formData.append("file 2", {
        uri: loanData.file2.uri,
        name: loanData.file2.name,
        type: loanData.file2.mimeType || "application/octet-stream",
      });
    }

    console.log("Loan Payload:", {
      employee: employeeCode,
      product_name: loanData.product_name,
      amount: loanData.amount,
      reason: loanData.reason,
      repayment_amount: loanData.repayment_amount,
      repayment_method: loanData.repayment_method,
      file1: loanData.file1,
      file2: loanData.file2,
    });

    const response = await apiClient.post(url, formData, {
      headers: {
        ...buildHeaders(token),
        "Content-Type": "multipart/form-data",
      },
    });

    console.log(
      "Loan Application Response:",
      response.status,
      JSON.stringify(response.data, null, 2),
    );

    return response.data;
  } catch (error) {
    console.log(
      "Loan Application Error:",
      error?.response?.status ?? error?.code ?? "no status",
      JSON.stringify(
        error?.response?.data ?? {
          message: error?.message,
        },
        null,
        2,
      ),
    );

    throw new Error(parseError(error, "Unable to submit loan application."));
  }
};

export default {
  getLoanProducts,
  LoanApplicationRequest,
};

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

    // Frappe caps File.file_name at 140 characters and measures the
    // percent-encoded form, so names are sanitized and truncated here before
    // they reach the server.
    const file1 = sanitizeAttachment(loanData.file1, "attachment-1");
    const file2 = sanitizeAttachment(loanData.file2, "attachment-2");

    if (file1) {
      formData.append("file1", {
        uri: file1.uri,
        name: file1.name,
        type: file1.type,
      });
    }

    // ===========================
    // File 2
    // ===========================

    if (file2) {
      formData.append("file 2", {
        uri: file2.uri,
        name: file2.name,
        type: file2.type,
      });
    }

    console.log("Loan Payload:", {
      employee: employeeCode,
      product_name: loanData.product_name,
      amount: loanData.amount,
      reason: loanData.reason,
      repayment_amount: loanData.repayment_amount,
      repayment_method: loanData.repayment_method,
      file1,
      file2,
    });

    // Do not set Content-Type here. React Native derives it from the FormData
    // body along with the multipart boundary; on iOS an explicit header is sent
    // verbatim, so the boundary is missing and the server parses no fields.
    // const response = await apiClient.post(url, formData, {
    //   headers: buildHeaders(token),
    // });
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
    console.log("========== LOAN API ERROR ==========");
    console.log("message:", error?.message);
    console.log("code:", error?.code);
    console.log("status:", error?.response?.status);
    console.log("response:", error?.response?.data);
    console.log("url:", error?.config?.url);
    console.log("method:", error?.config?.method);
    console.log("headers:", error?.config?.headers);
    console.log("request exists:", !!error?.request);
    console.log("====================================");

    throw error;
  }
};

export default {
  getLoanProducts,
  LoanApplicationRequest,
};

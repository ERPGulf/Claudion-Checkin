import apiClient from "./apiClient";
import {
  getAuthContext,
  buildHeaders,
  MISSING_EMPLOYEE_MESSAGE,
} from "./authHelper";
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

    // Tenants have been seen returning the list bare and wrapped, so unwrap
    // rather than trusting one shape: the callers map over this directly, and a
    // `{ message: [...] }` body would otherwise crash the screen rather than
    // showing an empty product list.
    const payload = response.data;

    if (Array.isArray(payload)) return payload;

    return payload?.message || payload?.data || [];
  } catch (error) {
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
      throw new Error(MISSING_EMPLOYEE_MESSAGE);
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_loan_application`;

    const formData = new FormData();

    formData.append("employee", employeeCode);
    formData.append("product_name", loanData.product_name);
    formData.append("amount", String(loanData.amount));
    formData.append("reason", loanData.reason);

    /* ===========================
       Repayment Details
    =========================== */

    if (
      loanData.repayment_amount !== undefined &&
      loanData.repayment_amount !== null
    ) {
      formData.append("repayment_amount", String(loanData.repayment_amount));
    }

    if (loanData.repayment_method) {
      formData.append("repayment_method", loanData.repayment_method);
    }

    /* ===========================
       Attachments
    =========================== */

    // Frappe caps File.file_name at 140 characters and measures the
    // percent-encoded form, so names are sanitized and truncated before they
    // reach the server. sanitizeAttachment also settles the mime type: the
    // pickers return `type`, not `mimeType`, so reading `mimeType` alone sent
    // every upload as application/octet-stream.
    const file1 = sanitizeAttachment(loanData.file1, "attachment-1");
    const file2 = sanitizeAttachment(loanData.file2, "attachment-2");

    if (file1) {
      formData.append("file1", {
        uri: file1.uri,
        name: file1.name,
        type: file1.type,
      });
    }

    // Keep "file 2" because that's what the backend currently uses.
    if (file2) {
      formData.append("file 2", {
        uri: file2.uri,
        name: file2.name,
        type: file2.type,
      });
    }

    const response = await apiClient.post(url, formData, {
      headers: {
        ...buildHeaders(token),
        "Content-Type": "multipart/form-data",
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(parseError(error, "Unable to submit loan application."));
  }
};

/* ===========================
   Get Loan Applications
=========================== */
export const getLoanApplications = async () => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: MISSING_EMPLOYEE_MESSAGE };
    }

    const url = `${baseUrl}/api/method/employee_app.employee_list.list_loan_application`;

    const response = await apiClient.get(url, {
      headers: buildHeaders(token),
    });

    if (!Array.isArray(response.data?.message)) {
      return { error: "Invalid loan application response." };
    }

    return { message: response.data.message };
  } catch (error) {
    return {
      error: parseError(error, "Unable to load loan applications."),
    };
  }
};

export default {
  getLoanProducts,
  LoanApplicationRequest,
  getLoanApplications,
};

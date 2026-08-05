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
    console.log("Loan Product URL:", url);

    const response = await apiClient.post(
      url,
      {},
      {
        headers: buildHeaders(token),
      },
    );
    console.log("Loan Products Response:", response.data);

    return response.data; // Returns [{ product_name: "test" }, { product_name: "car" }]
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

    if (loanData.file1) {
      formData.append("file1", {
        uri: loanData.file1.uri,
        name: loanData.file1.name,
        type: loanData.file1.mimeType || "application/octet-stream",
      });
    }

    // Keep "file 2" because that's what your backend/Postman currently uses.
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
      file1: loanData.file1,
      file2: loanData.file2,
    });

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

export default {
  getLoanProducts,
  LoanApplicationRequest,
};

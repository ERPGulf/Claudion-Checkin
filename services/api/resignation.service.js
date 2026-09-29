import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { sanitizeAttachment } from "../../utils/fileName";

/**
 * Frappe method that files an Employee Resignation for the authenticated
 * employee. The employee is resolved server-side from the bearer token, so the
 * payload carries no employee code.
 */
export const RESIGNATION_METHOD =
  "employee_app.employee_app_for_erpnext.doctype.employee_resignation.employee_resignation.create_employee_resignation";

/** Shown for every failure. Raw Frappe text stays in the log. */
export const RESIGNATION_ERROR_MESSAGE =
  "Unable to submit your resignation. Please try again.";

/**
 * What is safe to log about a failed request: the status, Frappe's exception
 * type and its first server message (logs only — never shown to employees).
 * Never the request body.
 */
const describeFailure = (error) => {
  const data = error?.response?.data;
  let serverTitle;
  let serverMessage;

  try {
    const first = JSON.parse(JSON.parse(data?._server_messages || "[]")[0] || "{}");
    serverTitle = first?.title;
    serverMessage =
      typeof first?.message === "string"
        ? first.message.replace(/<[^>]*>/g, "")
        : undefined;
  } catch {
    serverTitle = undefined;
  }

  return {
    status: error?.response?.status ?? "no response",
    excType: data?.exc_type,
    serverTitle,
    serverMessage: serverMessage ?? data?.exception,
    message: error?.message,
  };
};

/**
 * Appends an optional attachment under the form key the backend reads.
 * Names are sanitized first: Frappe caps File.file_name at 140 characters, and
 * `sanitizeAttachment` also settles the mime type the pickers report.
 */
const appendAttachment = (formData, key, file, fallbackName) => {
  const safe = sanitizeAttachment(file, fallbackName);
  if (!safe?.uri) return;

  formData.append(key, {
    uri: safe.uri,
    name: safe.name,
    type: safe.type || "application/octet-stream",
  });
};

/**
 * SUBMIT RESIGNATION
 *
 * Sends `resignation_date` (`YYYY-MM-DD HH:mm:ss`), `reason` and up to two
 * optional files (`file1`, `file2`) as one form-data request, so the record
 * and its attachments are created together. Resolves to `{ message }` holding
 * the created record (`{ name, employee, resignation_date, reason, file_url }`),
 * or `{ error }`.
 */
export const submitResignation = async ({
  resignationDate,
  reason,
  file1,
  file2,
}) => {
  try {
    const { baseUrl, token } = await getAuthContext();

    const formData = new FormData();
    formData.append("resignation_date", resignationDate);
    formData.append("reason", reason);
    appendAttachment(formData, "file1", file1, "resignation-1");
    appendAttachment(formData, "file2", file2, "resignation-2");

    const response = await apiClient.post(
      `${baseUrl}/api/method/${RESIGNATION_METHOD}`,
      formData,
      {
        headers: buildHeaders(token, "multipart/form-data"),
        timeout: 30000,
      },
    );

    const record = response?.data?.message;

    if (record?.name === undefined || record?.name === null) {
      console.log("❌ RESIGNATION: unexpected response shape");
      return { error: RESIGNATION_ERROR_MESSAGE };
    }

    return { message: record };
  } catch (error) {
    console.log("❌ RESIGNATION ERROR:", describeFailure(error));
    return { error: RESIGNATION_ERROR_MESSAGE };
  }
};

export default {
  submitResignation,
};

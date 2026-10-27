// src/services/api/featureSettings.service.js
import apiClient from "./apiClient";
import { getAuthContext, buildHeaders } from "./authHelper";
import { parseError } from "./errorHelper";
import { normalizeFeatureSettings, hasRecognizedFeatureSettings } from "../../utils/featureSettings";

/**
 * Which features this tenant has enabled for this employee.
 *
 * The tenant URL comes from `getAuthContext()`, which reads the `baseUrl` the
 * device was provisioned with by QR scan, and the bearer token comes from the
 * same place every other authenticated call gets it. Neither is ever written
 * into source: this app is multi-tenant and has no hardcoded backend.
 *
 * Follows the same `{ message } | { error }` contract as the other read
 * endpoints (`getExpenseClaims`, `getLoanApplications`), so the caller never has
 * to catch: a transport failure, an expired session or a malformed body all come
 * back as `{ error }`, and the store decides what to do about it.
 *
 * Development builds log the response body (never the token) so the raw API
 * answer can be checked from Metro; release builds log nothing.
 */
export const getFeatureSettings = async ({ context, capabilityScope } = {}) => {
  try {
    const { baseUrl, token } = context || await getAuthContext();

    const url = `${baseUrl}/api/method/employee_app.gauth.employee_checkin_setting`;

    const response = await apiClient.get(url, {
      headers: buildHeaders(token),
      ...(capabilityScope ? { capabilityScope } : {}),
    });
    if (__DEV__) {
      console.log("[featureSettings] employee_checkin_setting response", JSON.stringify(response.data, null, 2));
    }

    // Normalize at the transport boundary. An empty or malformed success is a
    // failed refresh, so it cannot erase the last valid explicit restrictions.
    if (!hasRecognizedFeatureSettings(response.data)) {
      return { error: "Unable to load feature settings." };
    }
    return { message: normalizeFeatureSettings(response.data) };
  } catch (error) {
    if (__DEV__) {
      console.log("[featureSettings] employee_checkin_setting failed", error?.response?.status ?? null, error?.message);
    }
    return {
      error: parseError(error, "Unable to load feature settings."),
    };
  }
};

export default {
  getFeatureSettings,
};

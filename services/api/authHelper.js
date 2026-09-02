// src/services/api/authHelper.js

import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

/**
 * The authenticated context every service builds its request from.
 *
 * This used to memoise the whole context — `baseUrl`, `token` and
 * `employeeCode` — in a module variable that was populated on first use and
 * only ever cleared by the manual "Log out" button. That copy went stale in
 * three separate ways:
 *
 *  - **The token.** A refresh writes a new one; the memoised copy kept the old.
 *    Requests sent through `apiClient` survived it, because its request
 *    interceptor overwrites `Authorization` with the current token — but the
 *    four `fetch()` attachment uploads (leave, expense, complaint, attendance)
 *    do not go through that interceptor, so they sent the dead token and the
 *    upload failed with no way to recover it.
 *  - **The employee.** A *forced* logout never cleared it, so re-authenticating
 *    as a different employee filed that employee's leave, expense and loan
 *    requests under the previous one's code.
 *  - **The tenant.** Re-provisioning by QR to a different server left the old
 *    `baseUrl` in place for the rest of the process.
 *
 * There is no cache now. AsyncStorage is the source of truth for all three
 * values, and it is written before any of them can be read back — `saveTokens`
 * awaits its write, and the QR scan awaits its own. Three reads per call is
 * nothing next to the request they are about to authorise, and it makes a whole
 * class of staleness impossible rather than requiring every future writer to
 * remember to invalidate.
 */

/** Shown when the device has no tenant. Distinct from an expired session. */
export const NOT_PROVISIONED_MESSAGE =
  "This device is not set up yet. Please scan your QR code.";

/**
 * Shown when the employee identifier the QR scan should have stored is absent.
 *
 * Deliberately NOT "Session expired": `employee_code` comes from provisioning,
 * never from authentication, so a missing one says nothing about the token. The
 * old copy sent employees to re-authenticate a session that was working, which
 * at best wasted their time and at worst had them re-scanning a QR code to fix
 * a problem logging in again cannot fix.
 */
export const MISSING_EMPLOYEE_MESSAGE =
  "Your employee details are missing from this device. Please scan your QR code again or contact your administrator.";

/**
 * Reads the current tenant, token and employee straight from storage.
 *
 * @returns {Promise<{baseUrl: string, token: string, employeeCode: string|null}>}
 * @throws when the device is unprovisioned or has no access token
 */
export const getAuthContext = async () => {
  const [rawBaseUrl, token, employeeCode] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_code"),
  ]);

  if (!rawBaseUrl) {
    throw new Error(NOT_PROVISIONED_MESSAGE);
  }

  // No token genuinely is an expired session — this is the one place the phrase
  // is accurate.
  if (!token) {
    throw new Error("Session expired");
  }

  return {
    baseUrl: cleanBaseUrl(rawBaseUrl),
    token,
    employeeCode,
  };
};

/**
 * Kept for the callers that invoke it on logout.
 *
 * There is no longer a cache to clear — `getAuthContext` reads storage every
 * time — so this is a no-op. It stays exported rather than being deleted so a
 * logout path cannot silently lose a step, and so that reintroducing a cache
 * later has an invalidation hook already wired into both logout paths.
 */
export const clearAuthCache = () => {};

/**
 * Common Header Builder
 */
export const buildHeaders = (token, contentType) => {
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  return headers;
};

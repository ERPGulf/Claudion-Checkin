import { t } from "../localization";
// utils/loginError.js
//
// Maps a login failure into a specific, user-actionable message so support can
// tell a connectivity / clock / SSL problem apart from a wrong password or a
// stale QR setup — instead of the single generic "Something went wrong" that
// previously hid all three behind the same text.
//
// Pure and framework-agnostic: returns { text1, text2 } for the Toast in
// screens/Login.jsx. Kept here (not inline) so it can be unit-tested.

// Thrown by generateToken()/the screen pre-check when provisioning is missing.
const SETUP_ERROR_PATTERN = /base url not found|scan qr|qr code/i;

// Thrown by generateToken() when the server DID answer, and answered 200, but
// the payload was missing a credential a session cannot work without. Matched
// before the no-response branch below: these errors carry no `error.response`,
// so without this they read as "can't reach the server" — the one diagnosis
// that is certainly wrong, since the server just replied.
const INCOMPLETE_CREDENTIALS_PATTERN = /refresh token|token not returned/i;

// Axios error codes that mean the request never got a usable server response.
const NO_RESPONSE_CODES = new Set([
  "ERR_NETWORK",
  "ECONNABORTED", // request timeout
  "ETIMEDOUT",
  "ERR_SSL_PROTOCOL_ERROR",
]);

export const getLoginErrorMessage = (error) => {
  const status = error?.response?.status ?? null;
  const code = error?.code ?? null;
  const message = typeof error?.message === "string" ? error.message : "";

  // 1. Missing / invalid provisioning (no baseUrl, or stale / bad QR data).
  if (SETUP_ERROR_PATTERN.test(message)) {
    return {
      text1: t("Setup expired"),
      text2: t("Please tap \"Rescan QR Code\" and try again."),
    };
  }

  // 2. The server replied, but without the credentials a session needs. Not the
  //    employee's problem and not a network problem — an administrator has to
  //    fix it server-side, so say so rather than sending them round the
  //    check-your-connection loop.
  if (INCOMPLETE_CREDENTIALS_PATTERN.test(message)) {
    return {
      text1: t("Sign-in incomplete"),
      text2:
        t("The server didn't issue the credentials this app needs. Please contact your administrator."),
    };
  }

  // 3. No response from the server → no internet, server unreachable, SSL/TLS
  //    handshake failure, request timeout, or the phone's date/time being wrong
  //    (all of which fail before the server ever replies).
  const hasResponse = Boolean(error?.response);
  if (!hasResponse || NO_RESPONSE_CODES.has(code) || message === "Network Error") {
    return {
      text1: t("Can't reach the server"),
      text2: t("Check your internet and the phone's date & time, then try again."),
    };
  }

  // 4. Server rejected the credentials.
  if (status === 401) {
    return {
      text1: t("Incorrect password"),
      text2: t("Please check your password and try again."),
    };
  }

  // Other server errors use app-owned copy; backend exceptions are not display text.
  return {
    text1: t("Login failed"),
    text2:
      status ? t("Something went wrong (error {{status}}). Please try again or contact your administrator.", { status }) : t("Something went wrong. Please try again or contact your administrator."),
  };
};

export default getLoginErrorMessage;

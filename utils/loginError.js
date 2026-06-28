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
      text1: "Setup expired",
      text2: 'Please tap "Rescan QR Code" and try again.',
    };
  }

  // 2. No response from the server → no internet, server unreachable, SSL/TLS
  //    handshake failure, request timeout, or the phone's date/time being wrong
  //    (all of which fail before the server ever replies).
  const hasResponse = Boolean(error?.response);
  if (!hasResponse || NO_RESPONSE_CODES.has(code) || message === "Network Error") {
    return {
      text1: "Can't reach the server",
      text2: "Check your internet and the phone's date & time, then try again.",
    };
  }

  // 3. Server rejected the credentials.
  if (status === 401) {
    return {
      text1: "Incorrect password",
      text2: "Please check your password and try again.",
    };
  }

  // 4. Any other server-side error → surface the server's own message if any.
  const serverMessage =
    error?.response?.data?.message || error?.response?.data?.exception || null;

  return {
    text1: "Login failed",
    text2:
      serverMessage || `Something went wrong${status ? ` (error ${status})` : ""}.`,
  };
};

export default getLoginErrorMessage;

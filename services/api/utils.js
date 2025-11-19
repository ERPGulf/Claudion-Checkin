// src/services/api/utils.js
export const cleanBaseUrl = (url = "") =>
  url?.trim().replace(/[\u0000-\u001F\u200B]+/g, "").replace(/\/+$/, "");

export const setCommonHeaders = (headers = {}) => {
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  return headers;
};

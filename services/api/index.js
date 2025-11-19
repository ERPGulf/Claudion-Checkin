// src/services/api/index.js
export * from "./apiClient";
export * from "./utils";

export * from "./auth.service";
export * from "./employee.service";
export * from "./attendance.service";
export * from "./upload.service";
export * from "./expense.service";
export * from "./leave.service";

import auth from "./auth.service";
import employee from "./employee.service";
import attendance from "./attendance.service";
import upload from "./upload.service";
import expense from "./expense.service";
import leave from "./leave.service";

export default {
  auth,
  employee,
  attendance,
  upload,
  expense,
  leave,
};

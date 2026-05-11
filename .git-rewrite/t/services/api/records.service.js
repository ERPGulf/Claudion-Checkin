import { getAuthRequest } from "./requestHelper";

/* ---------- Shortcut 1 ---------- */
export const getShortcut1 = async (employeeCode) => {
  try {
    const message = await getAuthRequest(
      "/api/method/employee_app.attendance_api.get_shortcut_1",
      { employee: employeeCode }
    );

    if (!message) throw new Error("No message found");

    return {
      shortcut: message.shortcut,
      data: message.data || {},
    };
  } catch (error) {
    throw error;
  }
};

/* ---------- Shortcut 2 ---------- */
export const getShortcut2 = async (employeeCode) => {
  try {
    const message = await getAuthRequest(
      "/api/method/employee_app.attendance_api.get_shortcut_2",
      { employee: employeeCode }
    );

    if (!message) throw new Error("No message found");

    return {
      shortcut: message.shortcut,
      data: message.fields || {},
    };
  } catch (error) {
    throw error;
  }
};

/* ---------- Shortcut 3 ---------- */
export const getShortcut3 = async (employeeCode) => {
  try {
    const message = await getAuthRequest(
      "/api/method/employee_app.attendance_api.get_shortcut_3",
      { employee: employeeCode }
    );

    if (!message) throw new Error("No message found");

    return {
      shortcut: message.shortcut,
      data: message.data || {},
    };
  } catch (error) {
    throw error;
  }
};

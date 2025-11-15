import AsyncStorage from "@react-native-async-storage/async-storage";
import userApi from "./apiManger";
import axios from "axios";
import { format } from "date-fns";
import { CommonActions } from "@react-navigation/native";

// Common headers

const setCommonHeaders = (headers = {}) => {
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  return headers;
};
// Refresh access token
let refreshPromise = null;
const clearRefreshPromise = () => (refreshPromise = null);

const refreshAccessToken = async () => {
  try {
    const refresh_token = await AsyncStorage.getItem("refresh_token");
    if (!refresh_token) throw new Error("No refresh token available");

    let baseUrl = await AsyncStorage.getItem("baseUrl");
    if (!baseUrl) throw new Error("Base URL missing");

    baseUrl = baseUrl
      .trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");

    // Call refresh token API (matches your curl)
    const params = new URLSearchParams();
    params.append("refresh_token", refresh_token);

    const { data } = await  userApi.get(
      `${baseUrl}/api/method/employee_app.gauth.create_refresh_token`,
      {
        headers: setCommonHeaders({
          Cookie:
            "full_name=aysha%20p; sid=Guest; system_user=no; user_id=Guest; user_image=",
        }),
        params,
      }
    );

    const accessToken = data?.data?.access_token;
    const newRefreshToken = data?.data?.refresh_token || refresh_token;

    if (!accessToken)
      throw new Error("Refresh token did not return access_token");

    await AsyncStorage.multiSet([
      ["access_token", accessToken],
      ["refresh_token", newRefreshToken],
    ]);

    return accessToken;
  } catch (error) {
    console.error(
      "❌ Token refresh error:",
      error.response?.data || error.message
    );
    throw error;
  }
};

// Request interceptor

userApi.interceptors.request.use(async (config) => {
  let baseUrl = await AsyncStorage.getItem("baseUrl");
  if (baseUrl) {
    baseUrl = baseUrl
      .trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    config.baseURL = `${baseUrl}/api`;
  }

  const access_token = await AsyncStorage.getItem("access_token");
  if (access_token) config.headers.Authorization = `Bearer ${access_token}`;

  return config;
});

// Response interceptor

userApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response &&
      [401, 403].includes(error.response.status) &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(clearRefreshPromise);
        }

        const newToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return userApi(originalRequest);
      } catch (refreshError) {
        console.error("❌ Error refreshing token:", refreshError);
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// Generate initial token

export const generateToken = async ({ api_key, app_key, api_secret }) => {
  try {
    let baseUrl = await AsyncStorage.getItem("baseUrl");
    if (!baseUrl)
      throw new Error("Base URL not found. Please scan QR code first.");

    baseUrl = baseUrl
      .trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");

    const body = new URLSearchParams();
    body.append("api_key", api_key);
    body.append("app_key", app_key);
    body.append("api_secret", api_secret);

    const response = await userApi.post(
      `${baseUrl}/api/method/employee_app.gauth.generate_token_secure`,
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const tokenData = response?.data?.data;
    const accessToken = tokenData?.access_token;
    const refreshToken = tokenData?.refresh_token;

    if (!accessToken) throw new Error("Token not returned from server");

    await AsyncStorage.multiSet([
      ["access_token", accessToken],
      ["refresh_token", refreshToken || ""],
    ]);

    return { access_token: accessToken, refresh_token: refreshToken };
  } catch (error) {
    console.error(
      "❌ generateToken error:",
      error.response?.data || error.message
    );
    throw error;
  }
};


// ✅ Common fetcher for employee data
export const fetchEmployeeData = async (employeeCode) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl
      ?.trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

    const { data } = await userApi.get(url, {
      params: { employee_id: employeeCode }, // ✅ correct param key
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });

    console.log("✅ Employee data response:", data);
    return data.message;
  } catch (error) {
    console.error(
      "❌ Get employee data error:",
      error.response?.data || error.message
    );
    throw error;
  }
};

// ✅ Get Custom Employee Fields
export const getUserCustomIn = async (employeeCode) => {
  if (!employeeCode) throw new Error("Employee ID is required");

  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = rawBaseUrl
    ?.trim()
    .replace(/[\u0000-\u001F]+/g, "")
    .replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Base URL missing");

  const token = await AsyncStorage.getItem("access_token");
  if (!token) throw new Error("Access token missing");

  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

  const { data } = await userApi.get(url, {
    params: { employee_id: employeeCode }, // ✅ correct param
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    timeout: 10000,
  });

  console.log("✅ Custom Employee Info:", data);
  return data.message;
};
//getofficelocation
export const getOfficeLocation = async (employeeCode) => {
  if (!employeeCode) throw new Error("Employee ID is required");

  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl
      ?.trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

    const { data } = await userApi.get(url, {
      params: { employee_id: employeeCode },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });

    const employee = data.message;

    if (!employee?.custom_reporting_location) {
      console.warn("⚠️ No reporting location found");
      return { latitude: null, longitude: null, radius: 0 };
    }

    let locationJson;
    try {
      locationJson = JSON.parse(employee.custom_reporting_location);
    } catch (err) {
      console.error("❌ Invalid location JSON format:", err);
      return { latitude: null, longitude: null, radius: 0 };
    }

    const coords = locationJson?.features?.[0]?.geometry?.coordinates || [
      null,
      null,
    ];

    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number"
    ) {
      console.warn("⚠️ Coordinates are missing or invalid");
      return { latitude: null, longitude: null, radius: 0 };
    }

    const longitude = coords[0];
    const latitude = coords[1];
    const radius = Number(employee.custom_reporting_radius) || 0;

    console.log("✅ Parsed coordinates:", { latitude, longitude, radius });
    return { latitude, longitude, radius };
  } catch (error) {
    console.error(
      "❌ Error getting office location:",
      error.response?.data || error.message
    );
    throw error;
  }
};

// User check-in/out

export const userCheckIn = async (fielddata) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl
      ?.trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Token missing");

    // ✅ Use date-fns to format timestamp properly
    const formattedTime = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    const payload = {
      device_id: "MobileAPP",
      employee_field_value: fielddata.employeeCode,
      log_type: fielddata.type,
      timestamp: formattedTime,
    };

    console.log("📤 Sending check-in:", payload);

    const response = await userApi.post(
      `${baseUrl}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ Check-in API response:", response.data);

    const checkinId = response.data?.message?.name;
    if (!checkinId) throw new Error("Missing check-in ID");

    return { name: checkinId };
  } catch (error) {
    console.error("❌ Check-in failed:", error);
    throw new Error("Something went wrong during check-in");
  }
};
// User file upload

export const userFileUpload = async (file, docname) => {
  try {
    if (!file || !file.uri) throw new Error("Invalid file data");
    if (!docname) throw new Error("Missing docname (check-in ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl
      ?.trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name || "userfile.png",
      type: file.type || "image/png",
    });
    formData.append("file_name", "qr");
    formData.append("doctype", "Employee Checkin");
    formData.append("docname", docname);

    console.log("📤 Uploading file with data:", {
      docname,
      fileName: file.name,
      uri: file.uri,
    });

    const response = await userApi.post(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    console.log("✅ Upload API response:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Upload API Error:", error.message || error);
    throw new Error("Photo upload failed");
  }
};

//put user file id
export const putUserFile = async (employeeCode) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = (rawBaseUrl || "")
      .trim()
      .replace(/[\u0000-\u001F\u200B]+/g, "")
      .replace(/\/+$/, "");
    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Missing access token");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);

    const { data } = await userApi.put(url, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
    });

    return data;
  } catch (error) {
    console.error(
      "Error updating employee:",
      error.response?.data || error.message
    );
    throw error;
  }
};

//user status put

export const userStatusPut = async (employeeCode, custom_in) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl
      ?.trim()
      .replace(/[\u0000-\u001F]+/g, "")
      .replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");
    if (!employeeCode) throw new Error("Employee code is required");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.employee`;
    console.log("🔗 PUT URL:", url);

    const formData = new URLSearchParams();
    formData.append("employee_code", employeeCode);
    formData.append("custom_in", String(custom_in));

    const { data } = await userApi.put(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    console.log("✅ Response:", data);
    return data;
  } catch (error) {
    console.error(
      "❌ userStatusPut error:",
      error.response?.data || error.message
    );
    throw new Error("Something went wrong while updating employee status");
  }
};

// //trip status

// export const userTripStatus = async (employeeCode) => {
//   try {
//     const { data } = await userApi.get(
//       "method/employee_app.attendance_api.get_latest_open_trip",
//       {
//         params: { employee_Code: employeeCode },
//       }
//     );
//     return data.message;
//   } catch (error) {
//     console.error(error, "trip status");
//     throw new Error("Something went wrong");
//   }
// };

// export const endTripTrack = async (formData) => {
//   try {
//     const { data } = await userApi.post(
//       "method/employee_app.attendance_api.close_the_trip",
//       formData,
//       { headers: setCommonHeaders() }
//     );

//     if (!data.message) throw new Error("Trip not ended");
//     return;
//   } catch (error) {
//     console.error(error, "trip end");
//     throw new Error("something went wrong");
//   }
// };

// // Contracts & Vehicles
// export const getContracts = async (searchTerms = "") => {
//   try {
//     const formData = new FormData();
//     formData.append("enter_name", searchTerms);
//     const { data } = await userApi.post(
//       "method/employee_app.attendance_api.contract_list",
//       formData,
//       {
//         headers: setCommonHeaders(),
//       }
//     );

//     const filteredData = data?.message?.flat(1);
//     if (!filteredData?.length)
//       return { filteredData, error: "no contracts available" };
//     return { filteredData, error: null };
//   } catch (error) {
//     console.error(error, "contract");
//     throw new Error("Something went wrong");
//   }
// };

// export const getVehicle = async (searchTerms = "") => {
//   try {
//     const formData = new FormData();
//     formData.append("vehicle_no", searchTerms);
//     formData.append("odometer", "");
//     formData.append("vehicle_model", "");
//     const { data } = await userApi.post(
//       "method/employee_app.attendance_api.vehicle_list",
//       formData,
//       {
//         headers: setCommonHeaders(),
//       }
//     );

//     const filteredData = data?.message?.flat(1);
//     if (!filteredData?.length)
//       return { filteredData, error: "no vehicle available" };
//     return { filteredData, error: null };
//   } catch (error) {
//     console.error(error, "vehicle");
//     throw new Error("Something went wrong");
//   }
// };

//User attendance

export const getUserAttendance = async (
  employee_id,
  limit_start = 0,
  limit_page_length = 20
) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      return {
        error: !rawBaseUrl
          ? "Base URL not found. Please scan QR code first."
          : "Access token missing. Please log in again.",
      };
    }

    const baseUrl = rawBaseUrl
      .trim()
      .replace(/[\u0000-\u001F\u200B]+/g, "")
      .replace(/\/+$/, "");
    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_attendance_details`;

    const response = await userApi.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      params: {
        employee_id,
        limit_start,
        limit_page_length,
      },
      timeout: 10000,
    });

    // Return the attendance list
    return response.data?.message || [];
  } catch (error) {
    console.error(
      "Attendance fetch error:",
      error.response?.data || error.message
    );
    return {
      error:
        error.response?.data?.message ||
        "Something went wrong while fetching attendance history.",
    };
  }
};
//get expense claims
export const getExpenseClaims = async () => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      throw new Error("Missing baseUrl or token in storage");
    }

    // ✅ Keep the double slash before "api"
    const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const url = `${baseUrl}//api/method/employee_app.attendance_api.get_expense_claims`;

    console.log("📡 Fetching expense claims from:", url);

    const response = await userApi.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = response.data?.message || response.data;

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("❌ Error fetching expense claims:", error);
    throw error;
  }
};
//create expense claim
export const createExpenseClaim = async (claimData) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl?.trim()?.replace(/\/+$/, "");
    const token = await AsyncStorage.getItem("access_token");
    const employee = await AsyncStorage.getItem("employee_code");

    if (!baseUrl || !token || !employee)
      throw new Error("Missing base URL, token, or employee code");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_expense_claim`;
    console.log("🔗 POST URL:", url);
    // ✅ Build multipart form data
    const formData = new FormData();
    formData.append("employee", employee);
    formData.append("expense_date", claimData.expense_date);
    formData.append("expense_type", claimData.expense_type);
    formData.append("amount", claimData.amount);
    formData.append("description", claimData.description || "");
    // ✅ Handle single file upload
    if (
      claimData.file_url &&
      Array.isArray(claimData.file_url) &&
      claimData.file_url.length > 0 &&
      claimData.file_url[0].uri
    ) {
      const file = claimData.file_url[0];
      const fileName = file.name || "upload.jpg";

      // 🔹 Extracted nested ternary into clear independent logic
      let fileType;
      if (file.mimeType) {
        fileType = file.mimeType;
      } else if (fileName.endsWith(".png")) {
        fileType = "image/png";
      } else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
        fileType = "image/jpeg";
      } else {
        fileType = "application/octet-stream";
      }

      formData.append("file_name", {
        uri: file.uri,
        name: fileName,
        type: fileType,
      });
    }

    console.log("📤 Form Data Entries:");
    console.log("📤 Sending expense claim (with file if any):", url);

    const response = await userApi.post(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "multipart/form-data",
      },
      transformRequest: (data) => data, 
    });

    console.log("✅ Expense claim created:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error creating expense claim:",
      error.response?.data || error.message
    );
    throw error;
  }
};
//user expense file upload
export const userExpenseFileUpload = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file data");

    if (!docname) throw new Error("Missing docname (claim ID)");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = rawBaseUrl?.trim().replace(/\/+$/, "");

    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.type || "application/octet-stream",
    });
    formData.append("is_private", 0);
    formData.append("doctype", "Expense Claim");
    formData.append("docname", docname);
    formData.append("fieldname", "file_url");

    const response = await userApi.post(
      `${baseUrl}/api/method/upload_file`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    console.log("✅ File uploaded:", response.data);
    return response.data;
  } catch (err) {
    console.error("❌ File upload failed:", err);
    throw err;
  }
};
//create leave application
export const createLeaveApplication = async (leaveData) => {
  try {
    const [rawBaseUrl, token, employeeCode] = await Promise.all([
      AsyncStorage.getItem("baseUrl"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("employee_code"),
    ]);

    if (!rawBaseUrl || !token || !employeeCode) {
      let missingMessage;

      if (!rawBaseUrl) {
        missingMessage = "Base URL not found. Please scan QR code first.";
        // eslint-disable-next-line no-negated-condition
      } else if (!token) {
        missingMessage = "Access token missing. Please log in again.";
      } else {
        missingMessage = "Employee code missing. Please scan QR code again.";
      }

      return { error: missingMessage };
    }

    const baseUrl = rawBaseUrl
      .trim()
      .replace(/[\u0000-\u001F\u200B]+/g, "")
      .replace(/\/+$/, "");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_leave_application`;

    const formatDate = (date) => {
      if (!date) return "";
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    };

    const remoteAgreementText = `I acknowledge and agree to the proposed remote work arrangement.
I will fulfill all my job responsibilities while working remotely and maintain regular communication with my team and supervisors.
I confirm that I possess the necessary equipment and technology required to perform my job remotely.
I agree to maintain the confidentiality of all company information.
I understand the employer may require me to return to the office if needed.
The employer reserves the right to approve or deny the leave request based on business needs.`;

    const formData = new URLSearchParams();
    formData.append("employee", employeeCode);
    formData.append("posting_date", formatDate(leaveData.posting_date));
    formData.append("leave_type", leaveData.leave_type);
    formData.append("from_date", formatDate(leaveData.from_date));
    formData.append("to_date", formatDate(leaveData.to_date));
    formData.append("reason", leaveData.reason || "N/A");

    if (
      leaveData.leave_type === "Remote" &&
      leaveData.acknowledgement_policy === 1
    ) {
      formData.append("acknowledgement_policy", "1");
      formData.append("agreement", remoteAgreementText);
    }

    const response = await userApi.post(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    console.error("❌ Error creating leave application:", error);
    return { error: error.message || "Something went wrong" };
  }
};

export default userApi;

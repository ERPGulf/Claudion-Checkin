import AsyncStorage from "@react-native-async-storage/async-storage";
import userApi from "./apiManger";
import axios from "axios";
import { format } from "date-fns";
import { CommonActions } from "@react-navigation/native";

const setCommonHeaders = (headers = {}) => {
  headers["Content-Type"] = "multipart/form-data";
  return headers;
};

const refreshAccessToken = async () => {
  try {
    const refresh_token = await AsyncStorage.getItem("refresh_token");
    const formdata = new FormData();
    formdata.append("grant_type", "refresh_token");
    formdata.append("refresh_token", refresh_token);

    const baseUrl = await AsyncStorage.getItem("baseUrl");

    const { data } = await userApi.post(
      "/method/employee_app.gauth.create_refresh_token",
      formdata,
      {
        baseURL: `${baseUrl}/api`, // append /api here
        headers: setCommonHeaders(),
      }
    );

    await AsyncStorage.multiSet([
      ["access_token", data.access_token],
      ["refresh_token", data.refresh_token],
    ]);

    return data.access_token;
  } catch (error) {
    console.error("Token refresh error:", error);
    throw new Error("Token refresh failed");
  }
};

// ✅ Handle token refresh in responses
let refreshPromise = null;
const clearPromise = () => (refreshPromise = null);

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
          refreshPromise = refreshAccessToken().finally(clearPromise);
        }
        const token = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return userApi(originalRequest);
      } catch (refreshError) {
        console.error("Error refreshing token:", refreshError);
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// ✅ Dynamic baseURL + token on every request
userApi.interceptors.request.use(async (config) => {
  const baseUrl = await AsyncStorage.getItem("baseUrl");

  if (baseUrl)
    config.baseURL = `${baseUrl}/api`; // append /api here
  else console.warn("⚠️ No baseUrl found in AsyncStorage");

  const access_token = await AsyncStorage.getItem("access_token");
  if (access_token) config.headers.Authorization = `Bearer ${access_token}`;
  console.log("Axios Request:", config.baseURL + config.url);
  return config;
});

// ✅ Generate and store tokens
export const generateToken = async ({ api_key, app_key, api_secret }) => {
  try {
    let baseUrl = await AsyncStorage.getItem("baseUrl");
    if (!baseUrl)
      throw new Error("Base URL not found. Please scan QR code first.");

    // Clean base URL
    baseUrl = baseUrl.trim().replace(/[\u0000-\u001F]+/g, "");
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    console.log("🔑 generateToken → baseUrl:", baseUrl);

    // Prepare form data
    const body = new URLSearchParams();
    body.append("api_key", api_key);
    body.append("app_key", app_key);
    body.append("api_secret", api_secret);

    // Make API call
    const response = await axios.post(
      `${baseUrl}/api/method/employee_app.gauth.generate_token_secure`,
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    console.log("✅ Token response:", response.data);

    // Extract token from nested data
    const tokenData = response?.data?.data;
    const accessToken = tokenData?.access_token;
    const refreshToken = tokenData?.refresh_token;

    if (accessToken) {
      await AsyncStorage.multiSet([
        ["access_token", accessToken],
        ["refresh_token", refreshToken || ""],
      ]);
      console.log("💾 Tokens saved:", { accessToken, refreshToken });
    } else {
      console.warn("⚠️ No access_token found in token response", response.data);
      throw new Error("Token not returned from server"); // keep it only here
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
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

    const { data } = await axios.get(url, {
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

  const { data } = await axios.get(url, {
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

    const { data } = await axios.get(url, {
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

    const response = await axios.post(
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

    const response = await axios.post(
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

    const { data } = await axios.put(url, formData, {
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

    const { data } = await axios.put(url, formData.toString(), {
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

//trip status

export const userTripStatus = async (employeeCode) => {
  try {
    const { data } = await userApi.get(
      "method/employee_app.attendance_api.get_latest_open_trip",
      {
        params: { employee_Code: employeeCode },
      }
    );
    return data.message;
  } catch (error) {
    console.error(error, "trip status");
    throw new Error("Something went wrong");
  }
};

export const endTripTrack = async (formData) => {
  try {
    const { data } = await userApi.post(
      "method/employee_app.attendance_api.close_the_trip",
      formData,
      { headers: setCommonHeaders() }
    );

    if (!data.message) throw new Error("Trip not ended");
    return;
  } catch (error) {
    console.error(error, "trip end");
    throw new Error("something went wrong");
  }
};

// Contracts & Vehicles
export const getContracts = async (searchTerms = "") => {
  try {
    const formData = new FormData();
    formData.append("enter_name", searchTerms);
    const { data } = await userApi.post(
      "method/employee_app.attendance_api.contract_list",
      formData,
      {
        headers: setCommonHeaders(),
      }
    );

    const filteredData = data?.message?.flat(1);
    if (!filteredData?.length)
      return { filteredData, error: "no contracts available" };
    return { filteredData, error: null };
  } catch (error) {
    console.error(error, "contract");
    throw new Error("Something went wrong");
  }
};

export const getVehicle = async (searchTerms = "") => {
  try {
    const formData = new FormData();
    formData.append("vehicle_no", searchTerms);
    formData.append("odometer", "");
    formData.append("vehicle_model", "");
    const { data } = await userApi.post(
      "method/employee_app.attendance_api.vehicle_list",
      formData,
      {
        headers: setCommonHeaders(),
      }
    );

    const filteredData = data?.message?.flat(1);
    if (!filteredData?.length)
      return { filteredData, error: "no vehicle available" };
    return { filteredData, error: null };
  } catch (error) {
    console.error(error, "vehicle");
    throw new Error("Something went wrong");
  }
};

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

    const response = await axios.get(url, {
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
// Get Expense Types (dummy)
export const getExpenseTypes = async () => {
  try {
    // right now: mock response
    await new Promise((resolve) => setTimeout(resolve, 800)); // simulate network delay

    return [
      { id: 1, name: "Travel" },
      { id: 2, name: "Food" },
      { id: 3, name: "Accommodation" },
      { id: 4, name: "Supplies" },
    ];
  } catch (error) {
    console.error("❌ getExpenseTypes error:", error);
    throw new Error("Failed to fetch expense types");
  }
};

// Create Expense Claim (dummy)
export const createExpenseClaim = async (employeeCode, claimData) => {
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));

    return {
      id: Math.floor(Math.random() * 10000), // fake ID
      employee: employeeCode,
      expense_type: claimData.expense_type,
      amount: claimData.amount,
      date: new Date().toISOString().split("T")[0],
      status: "Pending",
    };
  } catch (error) {
    console.error("❌ createExpenseClaim error:", error);
    throw new Error("Failed to create expense claim");
  }
};
export default userApi;

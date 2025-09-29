import AsyncStorage from "@react-native-async-storage/async-storage";
import userApi from "./apiManger";
import axios from "axios";

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

export const generateToken = async ({ api_key, app_key, api_secret }) => {
  try {
    // Step 1: Get baseUrl from AsyncStorage
    let baseUrl = await AsyncStorage.getItem("baseUrl");

    if (!baseUrl)
      throw new Error("Base URL not found. Please scan QR code first.");

    // Step 2: Sanitize baseUrl
    baseUrl = baseUrl.trim().replace(/[\u0000-\u001F]+/g, ""); // remove control chars
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    console.log("Sanitized baseUrl:", baseUrl);

    // Step 3: Prepare request body
    const body = new URLSearchParams();
    body.append("api_key", api_key);
    body.append("app_key", app_key);
    body.append("api_secret", api_secret);

    // Step 4: Make Axios request
    const response = await axios.post(
      `${baseUrl}/api/method/employee_app.gauth.generate_token_secure`,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000, // optional: 10 seconds timeout
      }
    );

    console.log("Token response:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Generate token error:", error.message || error);
    throw error;
  }
};

// Get office location
export const getOfficeLocation = async (employeeCode) => {
  try {
    const filters = [["name", "=", employeeCode]];
    const fields = ["name", "first_name", "custom_reporting_location"];
    const params = {
      filters: JSON.stringify(filters),
      fields: JSON.stringify(fields),
    };

    const url = `resource/Employee?${new URLSearchParams(params).toString()}`;
    const { data } = await userApi.get(url);

    const jsonData = JSON.parse(data.data[0].custom_reporting_location);
    const latitude = jsonData.features[0].geometry.coordinates[1];
    const longitude = jsonData.features[0].geometry.coordinates[0];

    return { latitude, longitude };
  } catch (error) {
    console.error(error, "location");
    throw new Error("location went wrong");
  }
};

// User check-in/out
export const userCheckIn = async (fielddata) => {
  try {
    const formData = new FormData();
    formData.append("employee_field_value", fielddata.employeeCode);
    formData.append("timestamp", fielddata.timestamp);
    formData.append("device_id", "MobileAPP");
    formData.append("log_type", fielddata.type);

    const { data } = await userApi.post(
      "method/hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field",
      formData,
      { headers: setCommonHeaders() }
    );

    if (!data) throw new Error("Employee not found");
    return data.message;
  } catch (error) {
    console.error(error, "checkin");
    throw new Error("something went wrong");
  }
};

// User file upload
export const userFileUpload = async (formdata) => {
  try {
    const { data } = await userApi.post("method/upload_file", formdata, {
      headers: setCommonHeaders(),
    });

    if (!data || !data.message?.file_url) throw new Error("Upload failed");
    return data.message;
  } catch (error) {
    console.error("Upload API Error:", error.response?.data || error.message);
    throw new Error("Photo upload failed");
  }
};

// PUT user file
export const putUserFile = async (formData, fileId) => {
  try {
    const { data } = await userApi.put(
      `resource/Employee Checkin/${fileId}`,
      formData,
      {
        headers: setCommonHeaders(),
      }
    );
    return data;
  } catch (error) {
    console.error(error, "image");
    throw error;
  }
};

// User status PUT
export const userStatusPut = async (employeeCode, custom_in) => {
  try {
    const formData = new FormData();
    formData.append("custom_in", custom_in);

    const { data } = await userApi.put(
      `resource/Employee/${employeeCode}`,
      formData,
      {
        headers: setCommonHeaders(),
      }
    );

    return data;
  } catch (error) {
    console.error(error, "status put");
    throw new Error("something went wrong");
  }
};

// Get user status
export const getUserCustomIn = async (employeeCode) => {
  try {
    const filters = [["name", "=", employeeCode]];
    const fields = [
      "name",
      "first_name",
      "custom_in",
      "custom_restrict_location",
      "custom_reporting_radius",
    ];
    const params = {
      filters: JSON.stringify(filters),
      fields: JSON.stringify(fields),
    };

    const url = `resource/Employee?${new URLSearchParams(params).toString()}`;
    const { data } = await userApi.get(url);
    return data.data[0];
  } catch (error) {
    console.error(error, "status");
    throw new Error("something went wrong");
  }
};

// Trip APIs
export const tripTrack = async (formData) => {
  try {
    const { data } = await userApi.post(
      "method/employee_app.attendance_api.insert_new_trip",
      formData,
      { headers: setCommonHeaders() }
    );

    if (!data.message) throw new Error("Trip not started");
    return data.message;
  } catch (error) {
    console.error(error, "trip");
    throw new Error("something went wrong");
  }
};

export const userTripStatus = async (employeeCode) => {
  try {
    const { data } = await userApi.get(
      "method/employee_app.attendance_api.get_latest_open_trip",
      {
        params: { employee_id: employeeCode },
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

// User attendance
export const getUserAttendance = async (employee_code, limit_start) => {
  try {
    const { data } = await userApi.get(
      "method/employee_app.attendance_api.employee_checkin",
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        params: { employee_code, limit_start, limit_page_length: 15 },
      }
    );

    return data.message;
  } catch (error) {
    console.error(error, "attendance");
    throw new Error("Something went wrong");
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

    // later when backend is ready:
    // const { data } = await userApi.get("method/employee_app.expense_api.expense_types");
    // return data.message;
  } catch (error) {
    console.error("❌ getExpenseTypes error:", error);
    throw new Error("Failed to fetch expense types");
  }
};

// Create Expense Claim (dummy)
export const createExpenseClaim = async (employeeCode, claimData) => {
  try {
    // mock behavior
    await new Promise((resolve) => setTimeout(resolve, 600)); // simulate network delay

    return {
      id: Math.floor(Math.random() * 10000), // fake ID
      employee: employeeCode,
      expense_type: claimData.expense_type,
      amount: claimData.amount,
      date: new Date().toISOString().split("T")[0],
      status: "Pending",
    };

    // later when backend is ready:
    // const formData = new FormData();
    // formData.append("employee", employeeCode);
    // formData.append("expense_type", claimData.expense_type);
    // formData.append("amount", claimData.amount);
    //
    // const { data } = await userApi.post("method/employee_app.expense_api.create_expense_claim", formData, {
    //   headers: setCommonHeaders(),
    // });
    // return data.message;
  } catch (error) {
    console.error("❌ createExpenseClaim error:", error);
    throw new Error("Failed to create expense claim");
  }
};
export default userApi;

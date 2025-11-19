// src/services/api/trip.service.js
import apiClient from "./apiClient";
import { setCommonHeaders } from "./utils";

/**
 * getContracts(searchTerms)
 * Restored exactly as original
 */
export const getContracts = async (searchTerms = "") => {
  try {
    const formData = new FormData();
    formData.append("enter_name", searchTerms);

    const { data } = await apiClient.post(
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

/**
 * getVehicle(searchTerms)
 * Restored exactly as original
 */
export const getVehicle = async (searchTerms = "") => {
  try {
    const formData = new FormData();
    formData.append("vehicle_no", searchTerms);
    formData.append("odometer", "");
    formData.append("vehicle_model", "");

    const { data } = await apiClient.post(
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

/**
 * tripTrack = endTripTrack
 * Your project was importing tripTrack, but original file named it endTripTrack.
 */
export const tripTrack = async (formData) => {
  try {
    const { data } = await apiClient.post(
      "method/employee_app.attendance_api.close_the_trip",
      formData,
      { headers: setCommonHeaders() }
    );

    if (!data.message) throw new Error("Trip not ended");
    return data.message;
  } catch (error) {
    console.error(error, "tripTrack");
    throw new Error("something went wrong");
  }
};
/**
 * userTripStatus(employeeCode)
 * Restored exactly as original
 */
export const userTripStatus = async (employeeCode) => {
  try {
    const { data } = await apiClient.get(
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

/**
 * endTripTrack(formData)
 * Restored exactly as original
 */
export const endTripTrack = async (formData) => {
  try {
    const { data } = await apiClient.post(
      "method/employee_app.attendance_api.close_the_trip",
      formData,
      { headers: setCommonHeaders() }
    );

    if (!data.message) throw new Error("Trip not ended");

    return data.message;
  } catch (error) {
    console.error(error, "trip end");
    throw new Error("Something went wrong");
  }
};

export default {
  userTripStatus,
  endTripTrack,
  tripTrack,
  getContracts,
  getVehicle,
};

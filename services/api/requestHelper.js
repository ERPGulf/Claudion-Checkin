import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { capabilityForRequest } from "./capabilityRequests";
import { assertCapability } from "../capabilityPolicy";

const TIMEOUT = 10000;

export const getAuthRequest = async (endpoint, params = {}) => {
  const employee = params.employee;

  if (!employee) {
    throw new Error("Employee ID missing");
  }

  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("Base URL missing");

  const token = await AsyncStorage.getItem("access_token");
  if (!token) throw new Error("Access token missing");

  const url = `${baseUrl}${endpoint}`;
  const capability = capabilityForRequest({ url });
  const capabilityScope = capability
    ? await assertCapability(capability, { baseUrl, employeeCode: employee })
    : undefined;

  const response = await apiClient.get(url, {
    ...(capabilityScope ? { capabilityScope } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    params,
    timeout: TIMEOUT,
  });

  return response?.data?.message;
};

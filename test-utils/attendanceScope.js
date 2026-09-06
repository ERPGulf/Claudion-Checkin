import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateAuthSession, invalidateAuthSession } from "../utils/authSessionGuard";

export const TEST_TENANT = "https://attendance.example.com";
export const loginQueueEmployee = async (employeeId, tenantKey = TEST_TENANT, token = "synthetic-access") => {
  const generation = invalidateAuthSession();
  await AsyncStorage.multiSet([
    ["employee_code", employeeId], ["baseUrl", tenantKey],
    ["access_token", token], ["api_key", `account-${employeeId}`],
  ]);
  activateAuthSession(generation);
};

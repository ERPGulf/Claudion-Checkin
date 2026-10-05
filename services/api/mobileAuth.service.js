import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { AuthError, createAuthClient } from "@erpgulf/auth-sdk";
import { Toast } from "react-native-toast-message/lib/src/Toast";
import { saveTokens, clearTokens, plainAxios } from "./apiClient";
import { getNotifications } from "./notification.service";
import { setSignIn } from "../../redux/Slices/AuthSlice";
import {
  setBaseUrl,
  setEmployeeCode,
  setFullname,
  setUsername,
  setUserDetails,
} from "../../redux/Slices/UserSlice";
import { setUnreadCount } from "../../redux/Slices/notificationSlice";
import {
  getAuthSessionGeneration,
  invalidateAuthSession,
} from "../../utils/authSessionGuard";
import { isMobileAuthAvailable } from "../../utils/mobileAuthCrypto";
import {
  CONFIG_KEY,
  assertCompleteAttendancePolicy,
  refreshAttendanceConfig,
} from "../offline/attendanceConfigCache";
import { CAPABILITY_KEY, clearOfflineCapability } from "../offline/offlineCapability";
import {
  createAttendanceScopeChangedError,
  normalizeAttendanceTenantKey,
} from "../offline/attendanceQueueProvenance";
import { SESSION_STATE_KEY, clearSessionState } from "../../utils/attendanceSessionState";
import { CHECKIN_START_TIME_KEY, clearPersistedCheckinStartTime } from "../../utils/attendanceSession";

const clients = new Map();
const handoffError = (code) => Object.assign(new Error("Mobile sign-in could not be completed."), { code });
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const HANDOFF_KEYS = [
  "baseUrl", "backendUrl", "api_key", "app_key", "company", "employee_code",
  "employee_id", "full_name", "auth_method", "photo", "restrict_location",
  "unrestricted_checkout_location", "employee_locations", "geotagging",
  CONFIG_KEY, CAPABILITY_KEY, SESSION_STATE_KEY, CHECKIN_START_TIME_KEY,
];

const parseBody = (text) => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * React Native's global fetch (XHR) ignores the SDK's `redirect: "error"`, so a
 * redirect could replay the form body and master bearer. expo/fetch enforces it.
 * Every HTTP status is a response; failures are fresh errors with no cause,
 * because a native error can carry request credentials. No logs, no retries.
 */
const authTransport = {
  async request({ method, url, headers, body, timeoutMs = 15000 }) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      // Required lazily: QR users load this module at startup too.
      const { fetch } = require("expo/fetch");
      const response = await fetch(url, {
        method,
        body,
        headers: { "Cache-Control": "no-store", ...headers },
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      });
      return { status: response.status, body: parseBody(await response.text()) };
    } catch {
      throw new AuthError(timedOut ? "TIMEOUT" : "NETWORK_ERROR", "Authentication request failed.");
    } finally {
      clearTimeout(timer);
    }
  },
};

/** A client retains only its own tenant's in-memory master token. */
export const getMobileAuthClient = (baseUrl) => {
  if (!clients.has(baseUrl)) {
    clients.set(baseUrl, createAuthClient({
      baseUrl,
      timeoutMs: 15000,
      transport: authTransport,
      metadata: {
        appId: "com.bazim.claudioncheckin",
        appVersion: Constants.nativeAppVersion ?? Constants.expoConfig?.version,
      },
    }));
  }
  return clients.get(baseUrl);
};

/**
 * Require explicit backend identity rather than assuming an SDK id is the QR
 * Employee_Code. Tenants may use a separate field for online attendance.
 * Staging must still verify the deployment's actual response contract.
 */
export const resolveMobileEmployeeIdentity = (result, employee) => {
  const docnames = [employee?.name, employee?.employee].filter(nonblank).map((value) => value.trim());
  const codes = [employee?.employee_code, employee?.employee_field_value].filter(nonblank).map((value) => value.trim());
  if (!docnames.length || new Set(docnames).size !== 1 || !codes.length || new Set(codes).size !== 1) {
    throw handoffError("MOBILE_IDENTITY_UNVERIFIED");
  }
  const docname = docnames[0];
  const sdkEmployee = result?.employee;
  if (
    ![sdkEmployee?.id, sdkEmployee?.name].includes(docname) ||
    !nonblank(employee?.employee_name)
  ) {
    throw handoffError("MOBILE_IDENTITY_UNVERIFIED");
  }
  return { employeeCode: codes[0], fullName: employee.employee_name.trim(), employeeDocname: docname };
};

/** SDK fetch stays inside the SDK; this is the separate attendance policy API. */
const downloadEmployeeContext = async (baseUrl, result) => {
  try {
    const { data } = await plainAxios.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`,
      {
        params: { employee_id: result.employee.id },
        headers: { Authorization: `Bearer ${result.token.accessToken}` },
        timeout: 10000,
      },
    );
    return data?.message;
  } catch {
    // Do not forward Axios response bodies into SDK diagnostics or the UI.
    throw handoffError("MOBILE_POLICY_UNAVAILABLE");
  }
};

export const completeMobileSignIn = async ({
  auth,
  flow,
  credentials,
  baseUrl,
  dispatch,
  isCancelled = () => false,
}) => {
  const generation = invalidateAuthSession();
  const assertCurrent = () => {
    if (generation !== getAuthSessionGeneration() || isCancelled()) {
      throw createAttendanceScopeChangedError();
    }
  };

  if (!isMobileAuthAvailable()) throw handoffError("MOBILE_AUTH_UNAVAILABLE");
  assertCurrent();
  const completion = await auth.complete(flow, credentials);
  assertCurrent();
  const result = completion?.status === "authenticated" ? completion.result : null;
  if (!nonblank(result?.token?.accessToken) || !nonblank(result?.token?.refreshToken)) {
    throw handoffError("MOBILE_SESSION_INCOMPLETE");
  }
  if (!nonblank(result?.employee?.id)) throw handoffError("MOBILE_IDENTITY_UNVERIFIED");

  // No provisioning, tokens or Redux writes until the backend supplies a
  // verifiable identity and complete attendance policy for this new employee.
  const employee = await downloadEmployeeContext(baseUrl, result);
  assertCurrent();
  const identity = resolveMobileEmployeeIdentity(result, employee);
  try {
    assertCompleteAttendancePolicy(employee);
  } catch {
    throw handoffError("MOBILE_POLICY_UNAVAILABLE");
  }
  const previousState = await AsyncStorage.multiGet(HANDOFF_KEYS);
  const previousBaseUrl = Object.fromEntries(previousState).baseUrl;
  assertCurrent();

  try {
    await AsyncStorage.multiRemove([
      "api_key", "app_key", "company", CONFIG_KEY,
      "photo", "restrict_location", "unrestricted_checkout_location",
      "employee_locations", "geotagging",
    ]);
    assertCurrent();
    await clearOfflineCapability();
    assertCurrent();
    await AsyncStorage.multiSet([
      ["baseUrl", baseUrl],
      ["backendUrl", baseUrl],
      ["employee_code", identity.employeeCode],
      ["employee_id", identity.employeeCode],
      ["full_name", identity.fullName],
      ["auth_method", "mobile"],
      // Conservative values until the prevalidated download is mirrored.
      ["restrict_location", "1"],
      ["unrestricted_checkout_location", "0"],
      ["photo", "1"],
    ]);
    assertCurrent();

    // Match generateToken's generation check and sole token persistence path.
    await saveTokens(result.token.accessToken, result.token.refreshToken, generation);
    assertCurrent();
    const policy = await refreshAttendanceConfig(identity.employeeCode, {
      requireCompletePolicy: true,
      employeeData: employee,
      expectedGeneration: generation,
    });
    assertCurrent();
    if (!policy.refreshed) throw handoffError("MOBILE_POLICY_UNAVAILABLE");

    if (
      previousBaseUrl &&
      normalizeAttendanceTenantKey(previousBaseUrl) !== normalizeAttendanceTenantKey(baseUrl)
    ) {
      // The existing owner key compares employee codes, which can collide
      // between tenants. Preserve same-tenant sessions and all queue records.
      await clearSessionState();
      assertCurrent();
      await clearPersistedCheckinStartTime();
      assertCurrent();
    }

    dispatch(setUsername(null));
    dispatch(setUserDetails(null));
    dispatch(setBaseUrl(baseUrl));
    dispatch(setEmployeeCode(identity.employeeCode));
    dispatch(setFullname(identity.fullName));
    dispatch(setSignIn({ isLoggedIn: true, token: result.token.accessToken }));
  } catch (error) {
    // A failed old operation must never tear down a newer employee's session.
    if (generation === getAuthSessionGeneration()) {
      const cleanup = clearTokens();
      const cleanupGeneration = getAuthSessionGeneration();
      await cleanup;
      if (cleanupGeneration === getAuthSessionGeneration()) {
        const absentKeys = previousState.filter(([, value]) => value == null).map(([key]) => key);
        if (absentKeys.length) await AsyncStorage.multiRemove(absentKeys);
        if (cleanupGeneration === getAuthSessionGeneration()) {
          await AsyncStorage.multiSet(previousState.filter(([, value]) => value != null));
        }
      }
    }
    throw error;
  }

  // Same best-effort unread count and success toast as useLogin. A successful
  // setSignIn normally unmounts this screen; do not treat that as cancellation.
  try {
    const notifications = await getNotifications(identity.employeeCode);
    if (generation === getAuthSessionGeneration()) {
      dispatch(setUnreadCount(notifications.filter((item) => Number(item.read) === 0).length));
    }
  } catch {}
  if (generation === getAuthSessionGeneration()) {
    Toast.show({ type: "success", text1: "Login successful", autoHide: true, visibilityTime: 3000 });
  }
  return { status: "authenticated" };
};

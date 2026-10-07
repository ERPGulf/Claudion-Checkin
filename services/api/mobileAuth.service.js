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
import { debugHeaders, logMobileAuthDebug } from "../../utils/mobileAuthDebug";

const clients = new Map();
let requestSequence = 0;
const handoffError = (code, details) => {
  logMobileAuthDebug("handoff.rejected", { code, ...details });
  return Object.assign(new Error("Mobile sign-in could not be completed."), { code });
};
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
 * because a native error can carry request credentials. No retries. The current
 * test-instance diagnostics log unredacted exchanges only in development.
 */
const authTransport = {
  async request({ method, url, headers, body, timeoutMs = 15000 }) {
    const requestId = ++requestSequence;
    const started = Date.now();
    const requestHeaders = { "Cache-Control": "no-store", ...headers };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    logMobileAuthDebug("request", {
      requestId, method, url, headers: requestHeaders, body, timeoutMs,
      form: body ? Object.fromEntries(new URLSearchParams(body)) : undefined,
      redirect: "error", credentials: "omit",
    }, "auth-sdk");
    try {
      // Required lazily: QR users load this module at startup too.
      const { fetch } = require("expo/fetch");
      const response = await fetch(url, {
        method,
        body,
        headers: requestHeaders,
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      });
      const rawBody = await response.text();
      const parsed = parseBody(rawBody);
      logMobileAuthDebug("response", {
        requestId, method, url, status: response.status,
        elapsedMs: Date.now() - started, headers: debugHeaders(response.headers),
        rawBody, body: parsed,
      }, "auth-sdk");
      return { status: response.status, body: parsed };
    } catch (error) {
      logMobileAuthDebug("request.failed", {
        requestId, method, url, elapsedMs: Date.now() - started,
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR", error,
      }, "auth-sdk");
      throw new AuthError(timedOut ? "TIMEOUT" : "NETWORK_ERROR", "Authentication request failed.");
    } finally {
      clearTimeout(timer);
    }
  },
};

/** A client retains only its own tenant's in-memory master token. */
export const getMobileAuthClient = (baseUrl) => {
  logMobileAuthDebug("client", { baseUrl, reused: clients.has(baseUrl) }, "auth-sdk");
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
    throw handoffError("MOBILE_IDENTITY_UNVERIFIED", {
      reason: "Missing or conflicting employee document names or attendance identifiers",
      sdkEmployee: result?.employee, employee, docnames, codes,
    });
  }
  const docname = docnames[0];
  const sdkEmployee = result?.employee;
  if (
    ![sdkEmployee?.id, sdkEmployee?.name].includes(docname) ||
    !nonblank(employee?.employee_name)
  ) {
    throw handoffError("MOBILE_IDENTITY_UNVERIFIED", {
      reason: "Employee document name does not match SDK identity, or display name is missing",
      sdkEmployee, employee, docname,
    });
  }
  return { employeeCode: codes[0], fullName: employee.employee_name.trim(), employeeDocname: docname };
};

/** SDK fetch stays inside the SDK; this is the separate attendance policy API. */
const downloadEmployeeContext = async (baseUrl, result) => {
  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;
  const params = { employee_id: result.employee.id };
  const headers = { Authorization: `Bearer ${result.token.accessToken}` };
  const started = Date.now();
  logMobileAuthDebug("employee.request", { method: "GET", url, params, headers, timeoutMs: 10000 });
  try {
    const response = await plainAxios.get(
      url,
      {
        params,
        headers,
        timeout: 10000,
      },
    );
    logMobileAuthDebug("employee.response", {
      url, status: response.status, headers: debugHeaders(response.headers),
      elapsedMs: Date.now() - started, body: response.data, employee: response.data?.message,
    });
    return response.data?.message;
  } catch (error) {
    logMobileAuthDebug("employee.failed", {
      url, params, elapsedMs: Date.now() - started, error,
      status: error?.response?.status, headers: debugHeaders(error?.response?.headers),
      body: error?.response?.data,
    });
    // Keep the app-owned error contract; raw data belongs only to dev logs.
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
  let stage = "availability";
  const traceStage = (next, details) => {
    stage = next;
    logMobileAuthDebug("handoff.stage", { stage, generation, ...details });
  };
  const assertCurrent = () => {
    if (generation !== getAuthSessionGeneration() || isCancelled()) {
      logMobileAuthDebug("handoff.cancelled", { stage, generation, currentGeneration: getAuthSessionGeneration() });
      throw createAttendanceScopeChangedError();
    }
  };

  logMobileAuthDebug("handoff.start", { baseUrl, generation, flow, credentials });
  try {
    if (!isMobileAuthAvailable()) throw handoffError("MOBILE_AUTH_UNAVAILABLE");
    assertCurrent();
    traceStage("sdk.complete", { baseUrl, flow, credentials });
    const completion = await auth.complete(flow, credentials);
    logMobileAuthDebug("handoff.sdk.result", { completion });
    assertCurrent();
    traceStage("session.validate");
    const result = completion?.status === "authenticated" ? completion.result : null;
    if (!nonblank(result?.token?.accessToken) || !nonblank(result?.token?.refreshToken)) {
      throw handoffError("MOBILE_SESSION_INCOMPLETE", { result });
    }
    if (!nonblank(result?.employee?.id)) throw handoffError("MOBILE_IDENTITY_UNVERIFIED", { result });

    // No provisioning, tokens or Redux writes until the backend supplies a
    // verifiable identity and complete attendance policy for this new employee.
    traceStage("employee.fetch");
    const employee = await downloadEmployeeContext(baseUrl, result);
    assertCurrent();
    traceStage("employee.identity", { sdkEmployee: result.employee, employee });
    const identity = resolveMobileEmployeeIdentity(result, employee);
    traceStage("employee.policy", { employee });
    try {
      assertCompleteAttendancePolicy(employee);
    } catch (error) {
      logMobileAuthDebug("employee.policy.invalid", { error, employee });
      throw handoffError("MOBILE_POLICY_UNAVAILABLE");
    }
    traceStage("provisioning.snapshot");
    const previousState = await AsyncStorage.multiGet(HANDOFF_KEYS);
    logMobileAuthDebug("handoff.provisioning.previous", { values: Object.fromEntries(previousState) });
    const previousBaseUrl = Object.fromEntries(previousState).baseUrl;
    assertCurrent();

    try {
      traceStage("provisioning.clear");
      await AsyncStorage.multiRemove([
        "api_key", "app_key", "company", CONFIG_KEY,
        "photo", "restrict_location", "unrestricted_checkout_location",
        "employee_locations", "geotagging",
      ]);
      assertCurrent();
      traceStage("capability.clear");
      await clearOfflineCapability();
      assertCurrent();
      traceStage("provisioning.write", { baseUrl, identity });
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
      traceStage("tokens.save", { token: result.token });
      await saveTokens(result.token.accessToken, result.token.refreshToken, generation);
      assertCurrent();
      traceStage("policy.cache");
      const policy = await refreshAttendanceConfig(identity.employeeCode, {
        requireCompletePolicy: true,
        employeeData: employee,
        expectedGeneration: generation,
      });
      logMobileAuthDebug("handoff.policy.cache.result", { policy });
      assertCurrent();
      if (!policy.refreshed) throw handoffError("MOBILE_POLICY_UNAVAILABLE", { policy });

      if (
        previousBaseUrl &&
        normalizeAttendanceTenantKey(previousBaseUrl) !== normalizeAttendanceTenantKey(baseUrl)
      ) {
        // The existing owner key compares employee codes, which can collide
        // between tenants. Preserve same-tenant sessions and all queue records.
        traceStage("attendance.session.clear", { previousBaseUrl, baseUrl });
        await clearSessionState();
        assertCurrent();
        await clearPersistedCheckinStartTime();
        assertCurrent();
      }

      traceStage("session.publish", { identity });
      dispatch(setUsername(null));
      dispatch(setUserDetails(null));
      dispatch(setBaseUrl(baseUrl));
      dispatch(setEmployeeCode(identity.employeeCode));
      dispatch(setFullname(identity.fullName));
      dispatch(setSignIn({ isLoggedIn: true, token: result.token.accessToken }));
    } catch (error) {
      logMobileAuthDebug("handoff.persistence.failed", { stage, error });
      // A failed old operation must never tear down a newer employee's session.
      if (generation === getAuthSessionGeneration()) {
        logMobileAuthDebug("handoff.rollback.start", { generation });
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
        logMobileAuthDebug("handoff.rollback.end", { cleanupGeneration, currentGeneration: getAuthSessionGeneration() });
      }
      throw error;
    }

    // Same best-effort unread count and success toast as useLogin. A successful
    // setSignIn normally unmounts this screen; do not treat that as cancellation.
    traceStage("notifications.fetch", { employeeCode: identity.employeeCode });
    try {
      const notifications = await getNotifications(identity.employeeCode);
      logMobileAuthDebug("handoff.notifications.result", { notifications });
      if (generation === getAuthSessionGeneration()) {
        dispatch(setUnreadCount(notifications.filter((item) => Number(item.read) === 0).length));
      }
    } catch (error) {
      logMobileAuthDebug("handoff.notifications.failed", { error, nonfatal: true });
    }
    if (generation === getAuthSessionGeneration()) {
      Toast.show({ type: "success", text1: "Login successful", autoHide: true, visibilityTime: 3000 });
    }
    logMobileAuthDebug("handoff.complete", { generation, currentGeneration: getAuthSessionGeneration() });
    return { status: "authenticated" };
  } catch (error) {
    logMobileAuthDebug("handoff.failed", { stage, generation, currentGeneration: getAuthSessionGeneration(), error });
    throw error;
  }
};

import { describeRunningUpdate } from "../utils/otaUpdate";

/**
 * Crash reporting through Firebase Crashlytics. This is the only module that
 * imports `@react-native-firebase/crashlytics`; everything else calls these
 * functions.
 *
 * Native crashes need none of this. The Firebase SDK installs its handlers when
 * Firebase starts, and firebase.json decides whether a build collects at all:
 * release builds do, debug builds do not. Loading the package here adds React
 * Native Firebase's global JS error handler, so an uncaught JS error is reported
 * with its JS stack, and makes the calls below work.
 *
 * Every export is a silent no-op while Crashlytics is unavailable: a binary
 * built before the native module existed (an OTA delivers this JS to it), Jest,
 * or any failure inside the SDK. Reporting must never be what breaks the app.
 *
 * Privacy. Nothing here sends names, phone numbers, emails, tokens, OTPs,
 * passwords or server payloads: the user ID is a one-way hash, attribute values
 * are primitives capped at MAX_VALUE_LENGTH, and a thrown non-Error is never
 * serialised into a report. Callers must keep the same rules for the context
 * they pass in.
 */

const MAX_VALUE_LENGTH = 100;
const MAX_LOG_LENGTH = 500;

/** The Crashlytics instance; `undefined` until initialised, `null` when unavailable. */
let crashlytics;
/** The package's modular API, kept with the instance it was loaded for. */
let api = null;
/** Bumped by every sign-in and sign-out, so a slow hash cannot land late. */
let userGeneration = 0;
let currentScreen = null;
/**
 * Non-fatals already reported this session. Crashlytics keeps only the latest
 * eight per session, so a failure repeated by a retry loop would evict the rest.
 */
const reported = new Set();

const safely = (call) => {
  if (!crashlytics) return;
  try {
    const result = call(api, crashlytics);
    if (typeof result?.catch === "function") result.catch(() => {});
  } catch {
    // Reporting must never break the caller.
  }
};

const sanitize = (attributes) => {
  const values = {};
  Object.entries(attributes ?? {}).forEach(([key, value]) => {
    if (["string", "number", "boolean"].includes(typeof value)) {
      values[key] = String(value).slice(0, MAX_VALUE_LENGTH);
    }
  });
  return values;
};

/** `https://user@acme.example.com:8000/path` → `acme.example.com:8000`. */
const toHost = (url) =>
  String(url ?? "")
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^/?#@]*@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();

/** Which JS bundle is running: the native version alone cannot tell two OTA updates apart. */
const getBuildAttributes = () => {
  try {
    const Updates = require("expo-updates");
    const running = describeRunningUpdate({
      updateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEnabled: Updates.isEnabled,
    });
    return {
      ota_source: running.source,
      ota_update: running.id ?? "",
      ota_channel: running.channel ?? "",
      runtime_version: running.runtimeVersion,
    };
  } catch {
    return {};
  }
};

/**
 * Loads Crashlytics. Call once, as early as possible: the JS error handler only
 * covers errors thrown after this runs.
 *
 * @returns {boolean} whether Crashlytics is available in this binary
 */
export const initializeCrashReporting = () => {
  if (crashlytics !== undefined) return crashlytics !== null;

  try {
    // Required, never imported: the package creates its native module on
    // import, so a static import would crash every binary built before
    // Crashlytics was added. Same constraint as utils/mobileAuthCrypto.js.
    api = require("@react-native-firebase/crashlytics");
    crashlytics = api.getCrashlytics();
  } catch {
    crashlytics = null;
    return false;
  }

  setCrashAttributes(getBuildAttributes());
  return true;
};

/**
 * Sets custom keys attached to every later report. Only strings, numbers and
 * booleans are sent; anything else is dropped rather than serialised.
 *
 * @param {Record<string, string|number|boolean>} attributes
 */
export const setCrashAttributes = (attributes) => {
  const values = sanitize(attributes);
  if (Object.keys(values).length) safely((lib, c) => lib.setAttributes(c, values));
};

/** Adds a breadcrumb to the log sent with the next crash or non-fatal. */
export const logCrashEvent = (message) => {
  safely((lib, c) => lib.log(c, String(message).slice(0, MAX_LOG_LENGTH)));
};

/**
 * Associates later reports with the signed-in employee and tenant.
 *
 * The user ID is the first 16 hex characters of SHA-256(`<employee
 * code>@<tenant host>`), never the code itself: on tenants that name Employee
 * records by full name, the code IS the person's name. Support can still find
 * one employee's crashes by computing the same hash:
 *
 *   printf '%s' 'HR-EMP-00042@acme.example.com' | shasum -a 256 | cut -c1-16
 *
 * @param {{employeeId?: string|null, tenantUrl?: string|null, authMethod?: string|null}} user
 */
export const setCrashUser = async ({ employeeId, tenantUrl, authMethod } = {}) => {
  if (!crashlytics) return;

  const generation = ++userGeneration;
  const tenant = toHost(tenantUrl);
  let userId = "";

  if (employeeId) {
    try {
      // Lazy for the same reason as Crashlytics: older binaries lack expo-crypto,
      // although any binary that has Crashlytics has it.
      const Crypto = require("expo-crypto");
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${employeeId}@${tenant}`,
      );
      userId = digest.slice(0, 16);
    } catch {
      // No user ID is better than a raw one.
    }
  }

  // A sign-out, or a newer sign-in, while hashing wins.
  if (generation !== userGeneration) return;

  safely((lib, c) => lib.setUserId(c, userId));
  setCrashAttributes({ tenant, auth_method: authMethod ?? "" });
};

/** Detaches the previous employee, so a later crash is not filed under them. */
export const clearCrashUser = () => {
  userGeneration += 1;
  safely((lib, c) => lib.setUserId(c, ""));
  setCrashAttributes({ tenant: "", auth_method: "" });
};

/** Records the route on screen, as a key on every report and a breadcrumb. */
export const setCrashScreen = (name) => {
  if (!name || name === currentScreen) return;
  currentScreen = name;
  setCrashAttributes({ screen: name });
  logCrashEvent(`screen ${name}`);
};

/**
 * Turns anything thrown into an Error. A thrown object is never serialised: it
 * may be a server payload.
 */
export const toError = (value) => {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value) return new Error(value);
  if (typeof value?.message === "string" && value.message) return new Error(value.message);
  return new Error(`Non-Error value thrown (${value === null ? "null" : typeof value})`);
};

/**
 * True for errors the JS engine raises when our own code is wrong (reading a
 * property of undefined, an invalid date, unparseable JSON), as opposed to the
 * expected failures the same catch blocks see: network, server refusals,
 * permissions, validation. React Native's fetch reports a dropped connection as
 * `TypeError: Network request failed`, so that one is excluded.
 */
export const isProgrammingError = (error) =>
  [TypeError, ReferenceError, RangeError, SyntaxError].some((Type) => error instanceof Type) &&
  !/network request failed/i.test(error.message);

const record = (error, label, context) => {
  const details = Object.entries(sanitize(context))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  logCrashEvent(`non-fatal ${error.name} ${details}`.trim());
  // The label becomes the report's top frame, so the console names the call
  // site even when the JS stack below it is minified.
  safely((lib, c) => lib.recordError(c, error, label));
};

/**
 * Reports a handled failure that should never happen. Expected outcomes (a
 * wrong OTP, a 401 the refresh handles, no network, a permission the user
 * denied, a validation refusal) are not reported: they would bury the real
 * problems.
 *
 * @param {unknown} error
 * @param {{feature?: string, action?: string, screen?: string} & Record<string, string|number|boolean>} [context]
 *        non-sensitive labels only; logged as a breadcrumb with the report
 */
export const recordNonFatalError = (error, context = {}) => {
  if (!crashlytics) return;

  const normalized = toError(error);
  const label =
    [context.feature, context.action].filter(Boolean).join(".") || normalized.name;
  const key = `${label}|${normalized.message}`;
  if (reported.has(key)) return;
  reported.add(key);

  record(normalized, label, context);
};

/**
 * Whether Crashlytics sends reports from this build. Release builds do; debug
 * builds only with `crashlytics_debug_enabled` in firebase.json.
 */
export const isCrashCollectionEnabled = () =>
  crashlytics?.isCrashlyticsCollectionEnabled === true;

/**
 * The test actions below exist for internal builds only: development builds and
 * the `preview` channel. A production binary never offers them, and they check
 * again themselves rather than trusting the screen that calls them.
 */
export const canRunCrashTests = () => {
  if (!crashlytics) return false;
  if (__DEV__) return true;
  try {
    return require("expo-updates").channel === "preview";
  } catch {
    return false;
  }
};

/** Records `CRASHLYTICS_TEST_NON_FATAL`. Not deduplicated, so it can be repeated. */
export const recordTestNonFatal = () => {
  if (!canRunCrashTests()) return false;
  record(new Error("CRASHLYTICS_TEST_NON_FATAL"), "crashlytics.test", {
    feature: "crashlytics",
    action: "test_non_fatal",
  });
  return true;
};

/**
 * Crashes the app natively through Crashlytics' own test API (SIGSEGV on iOS,
 * an uncaught RuntimeException on Android). Does nothing while collection is
 * off, which is the default for debug builds.
 */
export const triggerTestCrash = () => {
  if (!canRunCrashTests()) return false;
  logCrashEvent("test crash requested");
  safely((lib, c) => lib.crash(c));
  return true;
};

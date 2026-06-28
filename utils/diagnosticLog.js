// utils/diagnosticLog.js
//
// In-app diagnostic log buffer for debugging issues on RELEASE/PREVIEW builds
// where there is no Metro / `adb logcat` (e.g. an APK handed to a client to
// reproduce a login failure). It does two things:
//
//   1. installConsoleCapture() wraps console.log/info/warn/error so EVERY
//      existing log line in the app (apiClient refresh logs, the "Login failed"
//      log, etc.) is mirrored into a ring buffer — no need to re-instrument
//      call sites.
//   2. recordEvent(tag, data) records explicit, structured diagnostic events.
//
// The buffer is capped (MAX_ENTRIES) and persisted to AsyncStorage (throttled)
// so logs survive an app kill/restart and can be reviewed + shared from the
// Diagnostics screen.
//
// SECURITY: never pass secrets (passwords / api_secret / raw tokens) into
// recordEvent or console — this buffer is exported verbatim by the user. Mask
// tokens with maskSecret() and never log the login password.

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "diagnostic_logs";
const MAX_ENTRIES = 400;
const MAX_VALUE_LENGTH = 2000;
const PERSIST_DEBOUNCE_MS = 1000;

let entries = [];
let installed = false;
let persistTimer = null;
const originalConsole = {};

// ----------------------
// SAFE SERIALIZATION
// ----------------------
export const maskSecret = (value) => {
  if (!value || typeof value !== "string") {
    return value ?? null;
  }
  if (value.length <= 10) {
    return `${value.slice(0, 3)}…${value.slice(-2)}`;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

const safeStringify = (value) => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  const seen = new WeakSet();
  try {
    const json = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "function") return "[Function]";
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2,
    );
    return json ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable]";
    }
  }
};

const truncate = (text) =>
  typeof text === "string" && text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}… [truncated ${text.length - MAX_VALUE_LENGTH} chars]`
    : text;

const formatArgs = (args) =>
  args.map((arg) => truncate(safeStringify(arg))).join(" ");

// ----------------------
// BUFFER
// ----------------------
const pushEntry = (level, tag, message) => {
  entries.push({
    t: Date.now(),
    level,
    tag: tag ?? null,
    msg: truncate(message),
  });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  schedulePersist();
};

const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
};

/**
 * Record an explicit structured diagnostic event. `data` is serialized; pass
 * masked values only (never raw secrets).
 */
export const recordEvent = (tag, data) => {
  const message =
    data === undefined
      ? ""
      : typeof data === "string"
        ? data
        : safeStringify(data);
  pushEntry("event", tag, message);
};

export const getEntries = () => entries.slice();

export const clearEntries = async () => {
  entries = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * Load persisted entries from a previous app session and prepend them to the
 * buffer (so prior-session logs lead, current-session logs follow). Safe to
 * call after installConsoleCapture — it merges rather than replaces.
 */
export const loadPersistedEntries = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = [...parsed, ...entries].slice(-MAX_ENTRIES);
    }
  } catch {
    // ignore corrupt buffer
  }
};

// ----------------------
// CONSOLE CAPTURE
// ----------------------
export const installConsoleCapture = () => {
  if (installed) return;
  installed = true;

  ["log", "info", "warn", "error"].forEach((level) => {
    originalConsole[level] = console[level];
    console[level] = (...args) => {
      try {
        pushEntry(level, null, formatArgs(args));
      } catch {
        // capture must never break the original console call
      }
      if (typeof originalConsole[level] === "function") {
        originalConsole[level](...args);
      }
    };
  });
};

export const uninstallConsoleCapture = () => {
  if (!installed) return;
  ["log", "info", "warn", "error"].forEach((level) => {
    if (typeof originalConsole[level] === "function") {
      console[level] = originalConsole[level];
    }
  });
  installed = false;
};

// ----------------------
// REPORT
// ----------------------
const pad2 = (n) => String(n).padStart(2, "0");

const formatTime = (epochMs) => {
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/**
 * Build a shareable plain-text report. `header` is an object of label → value
 * pairs (device/app/build info) gathered by the Diagnostics screen.
 */
export const formatReport = (header = {}) => {
  const lines = [];
  lines.push("==== Claudion Check-in Diagnostics ====");
  lines.push(`Generated: ${new Date().toISOString()}`);
  Object.entries(header).forEach(([key, value]) => {
    lines.push(`${key}: ${value ?? "—"}`);
  });
  lines.push(`Entries: ${entries.length}`);
  lines.push("=======================================");

  if (entries.length === 0) {
    lines.push("(no log entries captured yet)");
  } else {
    entries.forEach((e) => {
      const tag = e.tag ? ` ${e.tag}:` : "";
      lines.push(`[${formatTime(e.t)}] ${e.level.toUpperCase()}${tag} ${e.msg}`);
    });
  }

  return lines.join("\n");
};

export default {
  recordEvent,
  getEntries,
  clearEntries,
  loadPersistedEntries,
  installConsoleCapture,
  uninstallConsoleCapture,
  formatReport,
  maskSecret,
};

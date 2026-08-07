import { FAILURE_CLASS } from "../services/offline/AttendanceDatabase";
import {
  FAILURE_KIND,
  classifyAttendanceError,
  classifyServerMessage,
  cleanServerMessage,
  isDuplicateMessage,
  isOfflineFailure,
} from "../services/offline/attendanceErrors";

/**
 * The classifier decides whether a payroll record is retried, parked or
 * abandoned, and the two ways of being wrong are not symmetric:
 *
 *   wrong "blocked"  → some pointless background requests, self-corrects
 *   wrong "rejected" → the attendance record is abandoned, silently
 *
 * So every test here is really checking one property: **nothing reaches REJECTED
 * except by a positive match on a known validation message.**
 */
describe("transport failures → PENDING", () => {
  it.each([
    ["axios network error", { message: "Network Error" }],
    ["axios timeout", { code: "ECONNABORTED", message: "timeout of 10000ms exceeded" }],
    ["connection reset", { code: "ECONNRESET", message: "socket hang up" }],
    ["dns temporary failure", { code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN" }],
    ["android dns", { message: 'Unable to resolve host "aysha.erpgulf.com"' }],
  ])("retries %s on the normal ladder", (_label, error) => {
    expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.PENDING);
    expect(isOfflineFailure(error)).toBe(true);
  });

  it("retries a 5xx — 'not now' is not 'not ever'", () => {
    const error = { response: { status: 502, data: {} } };
    expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.PENDING);
  });
});

describe("recoverable server failures → BLOCKED", () => {
  // The exact string returned by a tenant without the offline API deployed.
  // Pinned verbatim because the whole class hangs on matching it, and a Frappe
  // wording change must break this test rather than silently reclassify.
  const ENDPOINT_MISSING =
    "frappe.exceptions.ValidationError: Failed to get method for command " +
    "employee_app.attendance_api.add_offline_employee_checkins with module " +
    "'employee_app.attendance_api' has no attribute " +
    "'add_offline_employee_checkins'";

  it("classifies a missing endpoint as blocked, not rejected", () => {
    const error = { response: { status: 417, data: { message: ENDPOINT_MISSING } } };
    const result = classifyAttendanceError(error);

    expect(result.kind).toBe(FAILURE_KIND.BLOCKED);
    expect(result.failureClass).toBe(FAILURE_CLASS.ENDPOINT_MISSING);
  });

  it.each([
    ["not whitelisted", "Method not whitelisted"],
    ["unknown method", "method add_offline_employee_checkins does not exist"],
  ])("also catches %s", (_label, message) => {
    expect(classifyServerMessage(message)?.failureClass).toBe(
      FAILURE_CLASS.ENDPOINT_MISSING,
    );
  });

  it.each([401, 403])(
    "treats a bare %i as auth-blocked, since a refresh may fix it",
    (status) => {
      const result = classifyAttendanceError({ response: { status, data: {} } });
      expect(result.kind).toBe(FAILURE_KIND.BLOCKED);
      expect(result.failureClass).toBe(FAILURE_CLASS.AUTH);
    },
  );

  it("classifies a missing server configuration as blocked", () => {
    const result = classifyServerMessage(
      "Please set Naming Series in HR Settings",
    );
    expect(result.kind).toBe(FAILURE_KIND.BLOCKED);
    expect(result.failureClass).toBe(FAILURE_CLASS.CONFIGURATION);
  });

  // The fallback the entire design leans on.
  it.each([400, 404, 409, 417, 422])(
    "defaults an unrecognised %i to blocked, never rejected",
    (status) => {
      const error = {
        response: { status, data: { message: "something we have never seen" } },
      };
      const result = classifyAttendanceError(error);

      expect(result.kind).toBe(FAILURE_KIND.BLOCKED);
      expect(result.failureClass).toBe(FAILURE_CLASS.UNKNOWN);
    },
  );

  it("blocks an unexpected local error rather than consuming the record", () => {
    // A bug in our own payload building must not cost someone their attendance.
    expect(classifyAttendanceError(new TypeError("row.payload is undefined")).kind).toBe(
      FAILURE_KIND.BLOCKED,
    );
  });
});

describe("positively-identified validation → REJECTED", () => {
  it.each([
    "Employee HR-EMP-00001 is inactive",
    "Cannot create Employee Checkin for inactive employee",
    "No Employee found for the given ID",
    "Timestamp cannot be in the future",
    "Invalid log type",
  ])("rejects %s", (message) => {
    const result = classifyServerMessage(message);
    expect(result.kind).toBe(FAILURE_KIND.REJECTED);
    expect(result.failureClass).toBe(FAILURE_CLASS.VALIDATION);
  });

  // Both arrive as 417 with the same exception class. Only the message differs,
  // and the outcomes are opposite.
  it("separates an inactive employee from a missing endpoint at the same status", () => {
    const inactive = classifyAttendanceError({
      response: { status: 417, data: { message: "Employee is inactive" } },
    });
    const missing = classifyAttendanceError({
      response: {
        status: 417,
        data: { message: "module 'x' has no attribute 'y'" },
      },
    });

    expect(inactive.kind).toBe(FAILURE_KIND.REJECTED);
    expect(missing.kind).toBe(FAILURE_KIND.BLOCKED);
  });
});

describe("duplicates → success", () => {
  const frappeDuplicate =
    'This employee already has a log with the same timestamp.<Br><a href="/app/Form/Employee Checkin/EMP-CKIN-07-2026-000066" style="font-weight: bold;">Employee Checkin Aysha sithara12</a>';

  it("recognises the duplicate message through its HTML", () => {
    expect(isDuplicateMessage(frappeDuplicate)).toBe(true);
  });

  it("classifies it as DUPLICATE even at a 417", () => {
    const error = {
      response: { status: 417, data: { message: frappeDuplicate } },
    };
    expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.DUPLICATE);
  });

  it("does not mistake an ordinary validation error for a duplicate", () => {
    expect(isDuplicateMessage("Employee is inactive")).toBe(false);
  });
});

describe("cleanServerMessage", () => {
  it("strips the anchor and collapses whitespace so it can go in a sheet", () => {
    expect(
      cleanServerMessage('Already logged.<Br><a href="/app/x">Employee   Checkin</a>'),
    ).toBe("Already logged. Employee Checkin");
  });

  it("returns an empty string for non-strings rather than throwing", () => {
    expect(cleanServerMessage(undefined)).toBe("");
    expect(cleanServerMessage({ message: "x" })).toBe("");
  });
});

describe("classifyServerMessage", () => {
  it("returns null when nothing matches, so the caller applies its own default", () => {
    expect(classifyServerMessage("a message we have never seen")).toBeNull();
    expect(classifyServerMessage("")).toBeNull();
    expect(classifyServerMessage(null)).toBeNull();
  });
});

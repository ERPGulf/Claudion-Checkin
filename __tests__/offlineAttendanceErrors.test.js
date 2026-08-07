import {
  FAILURE_KIND,
  classifyAttendanceError,
  cleanServerMessage,
  isDuplicateMessage,
  isOfflineFailure,
} from "../services/offline/attendanceErrors";

/**
 * The classifier decides whether a failed punch is queued, dropped or quietly
 * accepted. Both wrong answers lose something: a misread timeout loses a real
 * check-in, a misread validation error retries a request the server will never
 * accept.
 */
describe("classifyAttendanceError", () => {
  describe("transport failures — retryable", () => {
    it.each([
      ["axios network error", { message: "Network Error" }],
      ["axios timeout", { code: "ECONNABORTED", message: "timeout of 10000ms exceeded" }],
      ["connection reset", { code: "ECONNRESET", message: "socket hang up" }],
      ["dns temporary failure", { code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN" }],
      ["host unreachable", { code: "EHOSTUNREACH", message: "no route to host" }],
      ["android dns", { message: "Unable to resolve host \"aysha.erpgulf.com\"" }],
    ])("treats %s as retryable", (_label, error) => {
      expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.RETRYABLE);
      expect(isOfflineFailure(error)).toBe(true);
    });

    it("retries a 5xx, because the server said 'not now' rather than 'no'", () => {
      const error = { response: { status: 502, data: {} } };
      expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.RETRYABLE);
    });
  });

  describe("server verdicts — terminal", () => {
    it.each([400, 401, 403, 404, 417, 422])(
      "does not retry a %i",
      (status) => {
        const error = { response: { status, data: { message: "nope" } } };
        expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.TERMINAL);
      },
    );

    it("does not retry an unrecognised local error, so a bug cannot loop", () => {
      const error = new TypeError("row.payload is undefined");
      expect(classifyAttendanceError(error).kind).toBe(FAILURE_KIND.TERMINAL);
    });

    it("reads the server's message out of the response body", () => {
      const error = {
        response: { status: 403, data: { message: "Not permitted" } },
      };
      expect(classifyAttendanceError(error).message).toBe("Not permitted");
    });
  });

  describe("duplicates", () => {
    // The retry that produces this is by design: a request that committed and
    // then timed out looks pending, so it is sent again. Recording it as an
    // error would leave a permanently failed row for a correct record.
    const frappeDuplicate =
      'This employee already has a log with the same timestamp.<Br><a href="/app/Form/Employee Checkin/EMP-CKIN-07-2026-000066" style="font-weight: bold;">Employee Checkin Aysha sithara12</a>';

    it("recognises the Frappe duplicate message through its HTML", () => {
      expect(isDuplicateMessage(frappeDuplicate)).toBe(true);
    });

    it("classifies it as DUPLICATE, not as a 417 rejection", () => {
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
    it("strips the anchor and collapses whitespace so it can go in a toast", () => {
      expect(
        cleanServerMessage(
          'Already logged.<Br><a href="/app/x">Employee   Checkin</a>',
        ),
      ).toBe("Already logged. Employee Checkin");
    });

    it("returns an empty string for non-strings rather than throwing", () => {
      expect(cleanServerMessage(undefined)).toBe("");
      expect(cleanServerMessage({ message: "x" })).toBe("");
    });
  });
});

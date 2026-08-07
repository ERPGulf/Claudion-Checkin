import {
  DEVICE_ID,
  PUSH_RESULT,
  buildCheckinRecord,
  interpretPushResponse,
} from "../services/offline/AttendanceApi";

/**
 * Reading the bulk endpoint's answer.
 *
 * The three statuses it reports (`success` / `partial_success` / `error`) are
 * not what decide the outcome — with one record per request the per-record
 * arrays say everything, and a duplicate arrives dressed as an error.
 */
const row = (overrides = {}) => ({
  id: 1,
  employeeId: "TDI0167",
  employeeDocname: "HR-EMP-00001",
  action: "checkin",
  timestamp: "2026-07-28 01:00:00",
  deviceId: DEVICE_ID,
  latitude: null,
  longitude: null,
  address: null,
  payload: {},
  ...overrides,
});

describe("buildCheckinRecord", () => {
  it("sends the documented six fields and nothing else", () => {
    // A bulk insert handed unknown keys can reject the whole call, and that
    // rejection is indistinguishable from a real validation failure.
    expect(Object.keys(buildCheckinRecord(row())).sort()).toEqual([
      "device_id",
      "employee",
      "log_type",
      "over_time",
      "timestamp",
    ]);
  });

  it("prefers the docname, which is what this endpoint resolves against", () => {
    expect(buildCheckinRecord(row()).employee).toBe("HR-EMP-00001");
  });

  it("falls back to the employee code when no docname was resolved", () => {
    expect(buildCheckinRecord(row({ employeeDocname: null })).employee).toBe(
      "TDI0167",
    );
  });

  it.each([
    ["checkin", "IN"],
    ["checkout", "OUT"],
  ])("maps %s to log_type %s", (action, logType) => {
    expect(buildCheckinRecord(row({ action })).log_type).toBe(logType);
  });

  it("carries the named office as the location", () => {
    const record = buildCheckinRecord(row({ payload: { location: "Doha HQ" } }));
    expect(record.location).toBe("Doha HQ");
  });

  // Coordinates ride in the `location` string rather than as extra keys, so the
  // position is not lost on a punch taken away from a named office.
  it("falls back to coordinates when there is no named office", () => {
    const record = buildCheckinRecord(
      row({ latitude: 25.276987, longitude: 51.520008 }),
    );
    expect(record.location).toBe("25.276987, 51.520008");
  });

  it("omits location entirely when there is nothing to say", () => {
    expect(buildCheckinRecord(row())).not.toHaveProperty("location");
  });

  // `describeLogSource` hides MobileAPP in history; anything else would put a
  // device chip on every offline punch.
  it("uses the same device id as the online path", () => {
    expect(buildCheckinRecord(row({ deviceId: null })).device_id).toBe("MobileAPP");
  });
});

describe("interpretPushResponse", () => {
  const successBody = {
    status: "success",
    message: "All records inserted successfully.",
    inserted_count: 1,
    failed_count: 0,
    inserted: ["EMP-CKIN-07-2026-000078"],
  };

  it("reads an inserted docname", () => {
    const outcome = interpretPushResponse(successBody);

    expect(outcome.result).toBe(PUSH_RESULT.INSERTED);
    expect(outcome.serverCheckinId).toBe("EMP-CKIN-07-2026-000078");
  });

  it("unwraps a body nested under `message`, as Frappe usually returns", () => {
    expect(interpretPushResponse({ message: successBody }).result).toBe(
      PUSH_RESULT.INSERTED,
    );
  });

  it("unwraps a body nested under `data`", () => {
    expect(interpretPushResponse({ data: successBody }).result).toBe(
      PUSH_RESULT.INSERTED,
    );
  });

  it("recognises the duplicate failure and strips its HTML", () => {
    const outcome = interpretPushResponse({
      status: "error",
      message: "Failed to insert records.",
      inserted: [],
      failed: [
        {
          employee: "HR-EMP-00001",
          timestamp: "2026-07-28 01:00:00",
          error:
            'This employee already has a log with the same timestamp.<Br><a href="/app/Form/Employee Checkin/EMP-CKIN-07-2026-000066">Employee Checkin</a>',
        },
      ],
    });

    expect(outcome.result).toBe(PUSH_RESULT.DUPLICATE);
    expect(outcome.message).not.toMatch(/</);
    expect(outcome.message).toMatch(/already has a log/);
  });

  it("treats a positively-identified validation failure as a rejection", () => {
    const outcome = interpretPushResponse({
      status: "error",
      inserted: [],
      failed: [{ error: "Employee is inactive" }],
    });

    expect(outcome.result).toBe(PUSH_RESULT.REJECTED);
    expect(outcome.message).toBe("Employee is inactive");
  });

  // The 417 that started all this. Same shape, same status, opposite handling.
  it("treats a missing endpoint as blocked, not rejected", () => {
    const outcome = interpretPushResponse({
      status: "error",
      inserted: [],
      failed: [
        {
          error:
            "module 'employee_app.attendance_api' has no attribute 'add_offline_employee_checkins'",
        },
      ],
    });

    expect(outcome.result).toBe(PUSH_RESULT.BLOCKED);
    expect(outcome.failureClass).toBe("endpoint-missing");
  });

  // The fallback the whole design leans on: never abandon what we cannot read.
  it("blocks an unrecognised per-record failure rather than rejecting it", () => {
    const outcome = interpretPushResponse({
      status: "error",
      inserted: [],
      failed: [{ error: "something nobody has seen before" }],
    });

    expect(outcome.result).toBe(PUSH_RESULT.BLOCKED);
    expect(outcome.failureClass).toBe("unknown");
  });

  // With one record per request a partial_success can only be one or the other,
  // and the arrays say which — the status label is not consulted.
  it("reads partial_success from its arrays, not its label", () => {
    expect(
      interpretPushResponse({
        status: "partial_success",
        inserted: ["EMP-CKIN-1"],
        failed: [],
      }).result,
    ).toBe(PUSH_RESULT.INSERTED);
  });

  it("blocks an empty body rather than reporting a phantom success", () => {
    expect(interpretPushResponse({}).result).toBe(PUSH_RESULT.BLOCKED);
    expect(interpretPushResponse(null).result).toBe(PUSH_RESULT.BLOCKED);
  });
});

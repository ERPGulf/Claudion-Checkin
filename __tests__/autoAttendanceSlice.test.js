import reducer, {
  normalizeGeotagging,
  requestAutoAttendanceSync,
  selectAutoAttendanceActive,
  selectAutoAttendanceAllowed,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceGeotagging,
  selectAutoAttendanceSyncRequestId,
  selectAutoAttendanceUserEnabled,
  setAutoAttendanceGeotagging,
  setAutoAttendanceUserEnabled,
} from "../redux/Slices/AutoAttendanceSlice";

const wrap = (autoAttendance) => ({ autoAttendance });

describe("AutoAttendanceSlice", () => {
  it("normalizeGeotagging clamps unknown/malformed values to DISABLED", () => {
    expect(normalizeGeotagging(0)).toBe(0);
    expect(normalizeGeotagging(1)).toBe(1);
    expect(normalizeGeotagging(2)).toBe(2);
    expect(normalizeGeotagging("2")).toBe(2);
    expect(normalizeGeotagging(undefined)).toBe(0);
    expect(normalizeGeotagging(5)).toBe(0);
    expect(normalizeGeotagging("nope")).toBe(0);
  });

  it("setAutoAttendanceGeotagging normalizes the payload", () => {
    const state = reducer(undefined, setAutoAttendanceGeotagging("2"));
    expect(state.geotagging).toBe(2);
    expect(reducer(state, setAutoAttendanceGeotagging(9)).geotagging).toBe(0);
  });

  it("setAutoAttendanceUserEnabled coerces to a boolean", () => {
    const state = reducer(undefined, setAutoAttendanceUserEnabled(true));
    expect(state.userEnabled).toBe(true);
    expect(reducer(state, setAutoAttendanceUserEnabled(0)).userEnabled).toBe(false);
  });

  it("is only ACTIVE when the admin allows it AND the user has opted in", () => {
    // allowed by admin but user hasn't opted in
    expect(
      selectAutoAttendanceActive(wrap({ geotagging: 2, userEnabled: false })),
    ).toBe(false);
    // user opted in but admin disabled it
    expect(
      selectAutoAttendanceActive(wrap({ geotagging: 0, userEnabled: true })),
    ).toBe(false);
    // both true
    expect(
      selectAutoAttendanceActive(wrap({ geotagging: 1, userEnabled: true })),
    ).toBe(true);
    expect(
      selectAutoAttendanceActive(wrap({ geotagging: 2, userEnabled: true })),
    ).toBe(true);
  });

  it("allowed / fullActions reflect the server policy alone", () => {
    expect(selectAutoAttendanceAllowed(wrap({ geotagging: 0 }))).toBe(false);
    expect(selectAutoAttendanceAllowed(wrap({ geotagging: 1 }))).toBe(true);
    expect(selectAutoAttendanceFullActions(wrap({ geotagging: 1 }))).toBe(false);
    expect(selectAutoAttendanceFullActions(wrap({ geotagging: 2 }))).toBe(true);
  });

  it("REVERT_ALL resets to disabled + opted-out", () => {
    const state = reducer(
      { geotagging: 2, userEnabled: true, syncRequestId: 3 },
      { type: "REVERT_ALL" },
    );
    expect(state).toEqual({
      geotagging: 0,
      userEnabled: false,
      syncRequestId: 0,
    });
  });

  describe("requestAutoAttendanceSync", () => {
    it("increments the id so the bootstrap re-runs registration", () => {
      const first = reducer(undefined, requestAutoAttendanceSync());
      expect(selectAutoAttendanceSyncRequestId(wrap(first))).toBe(1);

      const second = reducer(first, requestAutoAttendanceSync());
      expect(selectAutoAttendanceSyncRequestId(wrap(second))).toBe(2);
    });

    // Persisted state written before this field existed rehydrates without it.
    it("starts from zero when rehydrated state has no id", () => {
      const state = reducer(
        { geotagging: 2, userEnabled: true },
        requestAutoAttendanceSync(),
      );
      expect(state.syncRequestId).toBe(1);
    });

    it("selector defaults to zero for a missing slice", () => {
      expect(selectAutoAttendanceSyncRequestId({})).toBe(0);
    });
  });

  it("selectors tolerate a missing slice", () => {
    expect(selectAutoAttendanceActive({})).toBe(false);
    expect(selectAutoAttendanceUserEnabled({})).toBe(false);
    expect(selectAutoAttendanceGeotagging({})).toBe(0);
  });
});

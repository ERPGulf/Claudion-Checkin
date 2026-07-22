import reducer, {
  normalizeGeotagging,
  selectAutoAttendanceActive,
  selectAutoAttendanceAllowed,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceGeotagging,
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
      { geotagging: 2, userEnabled: true },
      { type: "REVERT_ALL" },
    );
    expect(state).toEqual({ geotagging: 0, userEnabled: false });
  });

  it("selectors tolerate a missing slice", () => {
    expect(selectAutoAttendanceActive({})).toBe(false);
    expect(selectAutoAttendanceUserEnabled({})).toBe(false);
    expect(selectAutoAttendanceGeotagging({})).toBe(0);
  });
});

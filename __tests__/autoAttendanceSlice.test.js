import reducer, {
  locationOnboardingAnswered,
  locationOnboardingReset,
  normalizeGeotagging,
  requestAutoAttendanceSync,
  selectAutoAttendanceAllowed,
  selectAutoAttendanceConfigured,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceGeotagging,
  selectAutoAttendanceMonitoring,
  selectAutoAttendanceOperational,
  selectAutoAttendanceSyncRequestId,
  selectLocationOnboardingAnswered,
  setAutoAttendanceGeotagging,
} from "../redux/Slices/AutoAttendanceSlice";
import { normalizeFeatureSettings } from "../utils/featureSettings";

const wrap = (autoAttendance) => ({ autoAttendance });
const TENANT = "https://tenant.example.com";
const EMPLOYEE = "HR-EMP-00001";
const SCOPE = `${TENANT}::${EMPLOYEE}`;
const OTHER_SCOPE = "https://other.example.com::HR-EMP-00002";

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

  it("allowed / fullActions reflect the server policy alone", () => {
    expect(selectAutoAttendanceAllowed(wrap({ geotagging: 0 }))).toBe(false);
    expect(selectAutoAttendanceAllowed(wrap({ geotagging: 1 }))).toBe(true);
    expect(selectAutoAttendanceFullActions(wrap({ geotagging: 1 }))).toBe(false);
    expect(selectAutoAttendanceFullActions(wrap({ geotagging: 2 }))).toBe(true);
  });

  it("REVERT_ALL resets to disabled, keeping only per-account onboarding answers", () => {
    const locationOnboarding = { [SCOPE]: true };
    const state = reducer(
      { geotagging: 2, syncRequestId: 3, monitoring: { scope: SCOPE, state: "active" }, locationOnboarding },
      { type: "REVERT_ALL" },
    );
    expect(state).toEqual({
      geotagging: 0,
      employeePolicy: null,
      employeeLocationPolicy: null,
      policyRequest: null,
      policySequence: 0,
      monitoring: null,
      locationOnboarding,
      syncRequestId: 0,
    });
  });

  describe("employer configuration", () => {
    const signedIn = ({
      attendanceAction = { geo_tagging: true }, mode = 2,
      settingsScope = SCOPE, policyScope = SCOPE, autoAttendance = {},
    } = {}) => ({
      userAuth: { isLoggedIn: true },
      user: { baseUrl: TENANT, userDetails: { employeeCode: EMPLOYEE } },
      featureSettings: { scope: settingsScope, settings: normalizeFeatureSettings({ attendance_action: attendanceAction }) },
      autoAttendance: {
        employeePolicy: mode === null ? null : { scope: policyScope, mode },
        ...autoAttendance,
      },
    });
    const configured = (options) => selectAutoAttendanceConfigured(signedIn(options));

    it.each([
      ["tenant disabled + employee enabled", false, 2, false],
      ["tenant enabled + employee disabled", true, 0, false],
      ["tenant enabled + employee enabled", true, 2, true],
      ["tenant disabled + employee disabled", false, 0, false],
    ])("%s", (_, tenant, mode, expected) => {
      expect(configured({ attendanceAction: { geo_tagging: tenant }, mode })).toBe(expected);
    });

    it.each([false, 0, null])("tenant geo_tagging %s disables it even for employee geotagging 2", (geo) => {
      expect(configured({ attendanceAction: { geo_tagging: geo } })).toBe(false);
    });

    it("respects an explicit null and never enables on a missing or malformed value", () => {
      expect(configured({ attendanceAction: { geo_tagging: null } })).toBe(false);
      // An older backend that omits the field reads as available to the
      // capability gates, but must never start background location.
      expect(configured({ attendanceAction: {} })).toBe(false);
      expect(configured({ attendanceAction: { geo_tagging: "true" } })).toBe(false);
      // A stale auto_attendance from an older build is not read at all.
      expect(configured({ attendanceAction: { auto_attendance: true } })).toBe(false);
    });

    it("stays disabled while either level is unresolved for this account", () => {
      expect(configured({ mode: null })).toBe(false);
      expect(configured({ settingsScope: OTHER_SCOPE })).toBe(false);
      expect(configured({ policyScope: OTHER_SCOPE })).toBe(false);
      expect(selectAutoAttendanceConfigured({ ...signedIn(), userAuth: { isLoggedIn: false } })).toBe(false);
    });

    it("does not configure monitoring for a warnings-only employee", () => {
      expect(configured({ mode: 1 })).toBe(false);
      expect(selectAutoAttendanceFullActions(signedIn({ mode: 1 }))).toBe(false);
    });

    it("is operational only once the bootstrap reports a registration for this account", () => {
      const reported = (monitoring, options) => signedIn({ ...options, autoAttendance: { monitoring } });
      expect(selectAutoAttendanceOperational(signedIn())).toBe(false);
      expect(selectAutoAttendanceOperational(reported({ scope: SCOPE, state: "permission" }))).toBe(false);
      expect(selectAutoAttendanceOperational(reported({ scope: SCOPE, state: "active" }))).toBe(true);
      expect(selectAutoAttendanceMonitoring(reported({ scope: OTHER_SCOPE, state: "active" }))).toBeNull();
      expect(selectAutoAttendanceOperational(
        reported({ scope: SCOPE, state: "active" }, { attendanceAction: { geo_tagging: false } }),
      )).toBe(false);
    });

    it("remembers an answered location explanation per account, through sign-out", () => {
      const answered = reducer(undefined, locationOnboardingAnswered({ scope: SCOPE }));
      const afterSignOut = reducer(answered, { type: "REVERT_ALL" });
      expect(selectLocationOnboardingAnswered(signedIn({ autoAttendance: afterSignOut }))).toBe(true);

      const otherEmployee = signedIn({ autoAttendance: afterSignOut });
      otherEmployee.user = { baseUrl: TENANT, userDetails: { employeeCode: "HR-EMP-00002" } };
      expect(selectLocationOnboardingAnswered(otherEmployee)).toBe(false);

      const otherTenant = signedIn({ autoAttendance: afterSignOut });
      otherTenant.user = { baseUrl: "https://other.example.com", userDetails: { employeeCode: EMPLOYEE } };
      expect(selectLocationOnboardingAnswered(otherTenant)).toBe(false);
    });

    it("forgets the answer for one account only, and tolerates state persisted before the record", () => {
      const both = reducer(
        reducer(undefined, locationOnboardingAnswered({ scope: SCOPE })),
        locationOnboardingAnswered({ scope: OTHER_SCOPE }),
      );
      expect(reducer(both, locationOnboardingReset({ scope: SCOPE })).locationOnboarding).toEqual({ [OTHER_SCOPE]: true });

      const persisted = { geotagging: 2, syncRequestId: 0 };
      expect(reducer(persisted, locationOnboardingReset({ scope: SCOPE }))).toEqual(persisted);
      expect(reducer(persisted, locationOnboardingAnswered({ scope: SCOPE })).locationOnboarding).toEqual({ [SCOPE]: true });
      expect(selectLocationOnboardingAnswered(signedIn({ autoAttendance: persisted }))).toBe(false);
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
        { geotagging: 2 },
        requestAutoAttendanceSync(),
      );
      expect(state.syncRequestId).toBe(1);
    });

    it("selector defaults to zero for a missing slice", () => {
      expect(selectAutoAttendanceSyncRequestId({})).toBe(0);
    });
  });

  it("selectors tolerate a missing slice", () => {
    expect(selectAutoAttendanceConfigured({})).toBe(false);
    expect(selectAutoAttendanceOperational({})).toBe(false);
    expect(selectAutoAttendanceMonitoring({})).toBeNull();
    expect(selectAutoAttendanceGeotagging({})).toBe(0);
  });
});

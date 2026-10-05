// The four tenant authentication modes, end to end through the installed SDK:
// backend policy + employee state → begin() → the resolved flow the screen
// renders. Each mode's policy triple follows the SDK's documented presets; the
// live Optional tenant sends exactly the Optional row.
import { createAuthClient } from "@erpgulf/auth-sdk";

// mode: sign-up password, [sign-in password, OTP], [cold-boot password, OTP]. Sign-up OTP is always Mandatory.
const MODES = {
  Password: ["Mandatory", ["Mandatory", "No"], ["Mandatory", "No"]],
  OTP: ["No", ["No", "Mandatory"], ["No", "Mandatory"]],
  Optional: ["Optional", ["Optional", "Optional"], ["Optional", "Optional"]],
  Both: ["Mandatory", ["Mandatory", "Mandatory"], ["Mandatory", "No"]],
};
const NEW = { signedUp: false, hasPassword: false };
const HAS_PASSWORD = { signedUp: true, hasPassword: true };
const NO_PASSWORD = { signedUp: true, hasPassword: false };
const MASTER = { data: { access_token: "fake-master", refresh_token: "fake-master-refresh", expires_in: 3600, token_type: "Bearer", scope: "all openid" } };
const SIGNED_IN = {
  status: "success",
  data: {
    token: { access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600, token_type: "Bearer", scope: "all openid" },
    employee: { id: "HR-EMP-FAKE", employee_name: "Fake Employee", phone: "5550001", email: null },
    password_policy: "Optional",
    otp_policy: "Optional",
    time: "2026-01-01 00:00:00",
  },
};
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: require("crypto").webcrypto });
});
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
  else delete globalThis.crypto;
});

const connect = (mode, { signedUp, hasPassword }) => {
  const [signUp, signIn, coldBoot] = MODES[mode];
  const policy = {
    status: "success",
    employee_id: "HR-EMP-FAKE",
    authentication: mode,
    sign_up_policy: { password_policy: signUp, otp_policy: "Mandatory" },
    sign_in_policy: { password_policy: signIn[0], otp_policy: signIn[1] },
    cold_boot_policy: { password_policy: coldBoot[0], otp_policy: coldBoot[1] },
    employee_has_existing_password: hasPassword,
    employee_has_signed_up: signedUp,
  };
  const transport = {
    request: jest.fn(async ({ url }) => ({
      status: 200,
      body: url.endsWith("master_token") ? MASTER : url.endsWith("get_employee_login_policy") ? policy : SIGNED_IN,
    })),
  };
  return { auth: createAuthClient({ baseUrl: "https://matrix.example.test", transport }), transport };
};
const endpoints = (transport) => transport.request.mock.calls.map(([request]) => request.url.split(".").pop());

it.each([
  // mode, situation, employee, cold boot, nextStep, password requirement, purpose, OTP requirement
  ["Password", "sign-up", NEW, false, "CREATE_PASSWORD_AND_ENTER_OTP", "required", "create", "required"],
  ["Password", "sign-in", HAS_PASSWORD, false, "ENTER_PASSWORD", "required", "existing", "disabled"],
  ["Password", "cold boot", HAS_PASSWORD, true, "ENTER_PASSWORD", "required", "existing", "disabled"],
  ["OTP", "sign-up", NEW, false, "ENTER_OTP", "disabled", "none", "required"],
  ["OTP", "sign-in", NO_PASSWORD, false, "ENTER_OTP", "disabled", "none", "required"],
  ["OTP", "cold boot", NO_PASSWORD, true, "ENTER_OTP", "disabled", "none", "required"],
  ["Optional", "sign-up", NEW, false, "ENTER_OTP_OPTIONAL_PASSWORD", "optional", "create", "required"],
  ["Optional", "sign-in with a password", HAS_PASSWORD, false, "ENTER_PASSWORD", "required", "existing", "disabled"],
  ["Optional", "cold boot with a password", HAS_PASSWORD, true, "ENTER_PASSWORD", "required", "existing", "disabled"],
  ["Optional", "sign-in without a password", NO_PASSWORD, false, "ENTER_OTP", "disabled", "none", "required"],
  ["Optional", "cold boot without a password", NO_PASSWORD, true, "ENTER_OTP", "disabled", "none", "required"],
  ["Both", "sign-up", NEW, false, "CREATE_PASSWORD_AND_ENTER_OTP", "required", "create", "required"],
  ["Both", "sign-in", HAS_PASSWORD, false, "ENTER_PASSWORD_AND_OTP", "required", "existing", "required"],
  ["Both", "cold boot", HAS_PASSWORD, true, "ENTER_PASSWORD", "required", "existing", "disabled"],
])("%s mode, %s", async (mode, situation, employee, coldBoot, nextStep, password, purpose, otp) => {
  const { auth } = connect(mode, employee);
  const flow = await auth.begin({ mobileNumber: "5550001", ...(coldBoot && { sessionActive: true }) });
  expect(flow).toMatchObject({
    action: coldBoot ? "COLD_BOOT" : employee.signedUp ? "SIGN_IN" : "SIGN_UP",
    nextStep,
    credentials: { password: { requirement: password, purpose }, otp: { requirement: otp } },
  });
});

it("an Optional employee with a password gets no create path, only a separate reset", async () => {
  const flow = await connect("Optional", HAS_PASSWORD).auth.begin({ mobileNumber: "5550001" });
  expect(flow.credentials.password).toEqual({ requirement: "required", purpose: "existing" });
  expect(flow.capabilities).toEqual({ canCreatePassword: false, canResetPassword: true });
});

it("refuses a sign-up state that claims an existing password", async () => {
  await expect(connect("Optional", { signedUp: false, hasPassword: true }).auth.begin({ mobileNumber: "5550001" }))
    .rejects.toMatchObject({ code: "UNSUPPORTED_POLICY" });
});

it.each([
  ["Password", { otp: "123456" }, HAS_PASSWORD],
  ["Optional", { otp: "123456" }, HAS_PASSWORD],
  ["Both", { password: "known password" }, HAS_PASSWORD],
  ["Both", { otp: "123456" }, HAS_PASSWORD],
  ["OTP", { password: "typed password" }, NO_PASSWORD],
])("%s mode refuses %j before any sign-in request (no credential can be skipped)", async (mode, credentials, employee) => {
  const { auth, transport } = connect(mode, employee);
  const flow = await auth.begin({ mobileNumber: "5550001" });
  await expect(auth.complete(flow, credentials)).rejects.toMatchObject({ code: "INVALID_SIGN_IN_INPUT" });
  expect(endpoints(transport)).toEqual(["master_token", "get_employee_login_policy"]);
});

it("Optional sign-in without a password takes only the code from the app; the SDK supplies its managed password", async () => {
  const { auth, transport } = connect("Optional", NO_PASSWORD);
  const flow = await auth.begin({ mobileNumber: "5550001" });
  await expect(auth.complete(flow, { otp: "123456" })).resolves.toMatchObject({ status: "authenticated" });
  const signIn = transport.request.mock.calls.find(([request]) => request.url.endsWith("sign_in_api"))[0];
  const form = new URLSearchParams(signIn.body);
  expect(form.get("otp")).toBe("123456");
  expect(form.get("password")).toMatch(/^egf_[A-Za-z0-9]{6}$/);
});

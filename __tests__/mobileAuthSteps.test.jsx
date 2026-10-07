import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthError, createAuthClient } from '@erpgulf/auth-sdk';
import useMobileLogin from '../hooks/useMobileLogin';
import { getMobileAuthClient, completeMobileSignIn } from '../services/api/mobileAuth.service';
import { isMobileAuthAvailable } from '../utils/mobileAuthCrypto';
import { getAuthSessionGeneration } from '../utils/authSessionGuard';

const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../services/api/mobileAuth.service', () => ({
  getMobileAuthClient: jest.fn(),
  completeMobileSignIn: jest.fn(),
}));
jest.mock('../utils/mobileAuthCrypto', () => ({ isMobileAuthAvailable: jest.fn(() => true) }));

const BACKEND = 'https://steps.example.test';
const MOBILE = '+5550001';
const OTP = '314159';
const PASSWORD = '  chosen password bytes  ';
const MODES = {
  Optional: ['Optional', 'Optional', 'Optional'],
  Password: ['Mandatory', 'Mandatory', 'No'],
  Both: ['Mandatory', 'Mandatory', 'Mandatory'],
  OTP: ['No', 'No', 'Mandatory'],
};
const TOKEN = {
  access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
  expires_in: 3600, token_type: 'Bearer', scope: 'all openid',
};
const EMPLOYEE = { id: 'HR-EMP-STEPS', employee_name: 'Synthetic Employee', phone: MOBILE, email: null };
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let client;
let transport;
let policy;

// Resolve every fixture through the installed SDK. In particular, Optional /
// Optional is one resolved factor, never an app-invented authentication choice.
function connect(mode = 'Optional', { signedUp = false, hasPassword = false } = {}) {
  const [signUpPassword, signInPassword, signInOtp] = MODES[mode];
  policy = {
    status: 'success', employee_id: EMPLOYEE.id,
    sign_up_policy: { password_policy: signUpPassword, otp_policy: 'Mandatory' },
    sign_in_policy: { password_policy: signInPassword, otp_policy: signInOtp },
    cold_boot_policy: { password_policy: signInPassword, otp_policy: signInOtp },
    employee_has_existing_password: hasPassword,
    employee_has_signed_up: signedUp,
  };
  transport = {
    request: jest.fn(async ({ url }) => {
      let body;
      if (url.endsWith('master_token')) body = { data: TOKEN };
      else if (url.endsWith('get_employee_login_policy')) body = policy;
      else if (url.endsWith('generate_and_send_otp')) body = { status: 'success', message: 'Sent', otp_expires_in: 30 };
      else if (url.endsWith('create_new_password')) body = { status: 'success' };
      else body = {
        status: 'success',
        data: {
          token: TOKEN, employee: EMPLOYEE, time: '2026-01-01 00:00:00',
          ...(url.endsWith('sign_in_api') && { password_policy: signInPassword, otp_policy: signInOtp }),
        },
      };
      return { status: 200, body };
    }),
  };
  client = createAuthClient({ baseUrl: BACKEND, transport });
  for (const method of ['begin', 'sendOtp', 'complete', 'setPasswordWithOtp']) jest.spyOn(client, method);
  getMobileAuthClient.mockReturnValue(client);
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const submittedCredentials = () => completeMobileSignIn.mock.calls.at(-1)[0].credentials;
const authenticationRequests = () => transport.request.mock.calls
  .map(([request]) => request)
  .filter(request => request.url.endsWith('sign_up_api') || request.url.endsWith('sign_in_api'));
const mount = async () => {
  await AsyncStorage.setItem('backendUrl', BACKEND);
  const view = renderHook(() => useMobileLogin());
  await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
  return view;
};
const start = async view => {
  act(() => view.result.current.setMobileNumber(MOBILE));
  await act(async () => { await view.result.current.begin(); });
};
const enterOtp = async (view, code = OTP) => {
  act(() => view.result.current.setOtp(code));
  await act(async () => { await view.result.current.submitOtp(); });
};
const enterNewPassword = (view, password = PASSWORD, confirmation = password) => act(() => {
  view.result.current.setNewPassword(password);
  view.result.current.setConfirmPassword(confirmation);
});

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: require('node:crypto').webcrypto });
});
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else delete globalThis.crypto;
});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  isMobileAuthAvailable.mockReturnValue(true);
  completeMobileSignIn.mockImplementation(options => options.auth.complete(options.flow, options.credentials));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  connect();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('stages signup OTP before the optional password decision, then submits both through SDK complete', async () => {
  const view = await mount();
  expect(view.result.current.step).toBe('MOBILE');
  await start(view);
  expect(view.result.current.step).toBe('OTP');
  expect(view.result.current.flow.nextStep).toBe('ENTER_OTP_OPTIONAL_PASSWORD');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  const startedFlow = view.result.current.flow;
  const requestsBeforeCode = transport.request.mock.calls.length;
  await enterOtp(view, ' 314 159 ');
  expect(view.result.current.step).toBe('PASSWORD_OPTION');
  expect(transport.request).toHaveBeenCalledTimes(requestsBeforeCode);
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
  enterNewPassword(view);
  expect(view.result.current.isNewPasswordValid).toBe(true);
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.complete).toHaveBeenCalledWith(startedFlow, { otp: OTP, password: PASSWORD });
  expect(view.result.current).toMatchObject({ step: 'COMPLETE', otp: '', newPassword: '', confirmPassword: '' });
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(authenticationRequests()).toHaveLength(1);
  view.unmount();
});

it('skips an optional signup password even when an invalid password draft exists', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view, 'short', 'different');
  await act(async () => { await view.result.current.skipPassword(); });
  expect(submittedCredentials()).toEqual({ otp: OTP });
  const form = new URLSearchParams(authenticationRequests()[0].body);
  expect(form.get('otp')).toBe(OTP);
  expect(form.get('password')).toMatch(/^egf_[A-Za-z0-9]{6}$/);
  expect(view.result.current.step).toBe('COMPLETE');
  expect(view.result.current.newPassword).toBe('');
  view.unmount();
});

it('requires password creation after mandatory signup OTP and refuses Skip', async () => {
  connect('Both');
  const view = await mount();
  await start(view);
  await enterOtp(view);
  expect(view.result.current.step).toBe('PASSWORD_CREATE');
  await act(async () => { await view.result.current.skipPassword(); });
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(view.result.current.step).toBe('PASSWORD_CREATE');
  enterNewPassword(view);
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(submittedCredentials()).toEqual({ otp: OTP, password: PASSWORD });
  expect(view.result.current.step).toBe('COMPLETE');
  view.unmount();
});

it('completes no-password signup directly from the OTP screen', async () => {
  connect('OTP');
  const view = await mount();
  await start(view);
  expect(view.result.current.step).toBe('OTP');
  await enterOtp(view);
  expect(submittedCredentials()).toEqual({ otp: OTP });
  expect(view.result.current.step).toBe('COMPLETE');
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
  view.unmount();
});

it.each([
  [true, 'ENTER_PASSWORD', 'PASSWORD_SIGN_IN', 0],
  [false, 'ENTER_OTP', 'OTP', 1],
])('uses the SDK-selected Optional sign-in factor when existing password is %s', async (hasPassword, sdkStep, step, sends) => {
  connect('Optional', { signedUp: true, hasPassword });
  const view = await mount();
  await start(view);
  expect(view.result.current.flow.nextStep).toBe(sdkStep);
  expect(view.result.current.step).toBe(step);
  expect(client.sendOtp).toHaveBeenCalledTimes(sends);
  if (hasPassword) {
    act(() => { view.result.current.setPassword(PASSWORD); view.result.current.setOtp('unused-code'); });
    await act(async () => { await view.result.current.continuePasswordSignIn(); });
    expect(submittedCredentials()).toEqual({ password: PASSWORD });
  } else {
    act(() => view.result.current.setPassword('unused-password'));
    await enterOtp(view);
    expect(submittedCredentials()).toEqual({ otp: OTP });
  }
  expect(view.result.current.step).toBe('COMPLETE');
  view.unmount();
});

it('collects both mandatory sign-in credentials on separate steps and sends OTP once after password', async () => {
  connect('Both', { signedUp: true, hasPassword: true });
  const view = await mount();
  await start(view);
  expect(view.result.current.step).toBe('PASSWORD_SIGN_IN');
  expect(client.sendOtp).not.toHaveBeenCalled();
  act(() => view.result.current.setPassword(PASSWORD));
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  expect(view.result.current.step).toBe('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(client.complete).not.toHaveBeenCalled();
  view.rerender();
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(view);
  expect(submittedCredentials()).toEqual({ password: PASSWORD, otp: OTP });
  expect(view.result.current.step).toBe('COMPLETE');
  view.unmount();
});

it('serializes password-to-OTP navigation and returns to password without another OTP send', async () => {
  connect('Both', { signedUp: true, hasPassword: true });
  const view = await mount();
  await start(view);
  act(() => view.result.current.setPassword(PASSWORD));
  const pending = deferred();
  client.sendOtp.mockReturnValueOnce(pending.promise);
  let sending;
  act(() => {
    sending = view.result.current.continuePasswordSignIn();
    view.result.current.continuePasswordSignIn();
  });
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ expiresIn: 30 }); await sending; });
  act(() => {
    view.result.current.setOtp(OTP);
    view.result.current.goBack();
  });
  expect(view.result.current).toMatchObject({ step: 'PASSWORD_SIGN_IN', password: PASSWORD, otp: '' });
  act(() => view.result.current.setPassword('changed password bytes'));
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  expect(view.result.current.step).toBe('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(view);
  expect(submittedCredentials()).toEqual({ otp: OTP, password: 'changed password bytes' });
  view.unmount();
});

it('requires a nonblank OTP without imposing a new fixed code length', async () => {
  connect('OTP', { signedUp: true });
  const view = await mount();
  await start(view);
  await enterOtp(view, '   ');
  expect(view.result.current.step).toBe('OTP');
  expect(view.result.current.otpError).toBeTruthy();
  expect(client.complete).not.toHaveBeenCalled();
  await enterOtp(view, ' 12 34 ');
  expect(submittedCredentials()).toEqual({ otp: '1234' });
  view.unmount();
});

it('keeps rejected sign-in OTP on the OTP step, clears its value, and never automatically resends', async () => {
  connect('OTP', { signedUp: true });
  const view = await mount();
  await start(view);
  client.complete.mockRejectedValueOnce(new AuthError('INVALID_OR_EXPIRED_OTP', 'untrusted backend text', { httpStatus: 417 }));
  await enterOtp(view);
  expect(view.result.current).toMatchObject({ step: 'OTP', otp: '' });
  expect(view.result.current.otpError).toContain('invalid or expired');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(console.log.mock.calls)).toContain('untrusted backend text');
  view.unmount();
});

it('returns signup OTP rejection to the OTP step while retaining the chosen password draft', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  client.complete.mockRejectedValueOnce(new AuthError('INVALID_OR_EXPIRED_OTP', 'untrusted', { httpStatus: 417 }));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(view.result.current).toMatchObject({ step: 'OTP', otp: '', newPassword: PASSWORD, confirmPassword: PASSWORD });
  expect(view.result.current.otpError).toContain('invalid or expired');
  await enterOtp(view, '271828');
  expect(view.result.current.step).toBe('PASSWORD_OPTION');
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(submittedCredentials()).toEqual({ otp: '271828', password: PASSWORD });
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('returns a real SDK signup business rejection to OTP while retaining the password draft', async () => {
  const request = transport.request.getMockImplementation();
  let rejectSignup = true;
  transport.request.mockImplementation(options => {
    if (rejectSignup && options.url.endsWith('sign_up_api')) {
      rejectSignup = false;
      return Promise.resolve({ status: 200, body: { status: 'error', message: 'Invalid or expired OTP' } });
    }
    return request(options);
  });
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  await act(async () => { await view.result.current.submitNewPassword(); });
  // Signup business errors are generic AUTHENTICATION_FAILED in SDK 0.1.2;
  // consumers must never parse the backend message to identify a credential.
  expect(console.log).toHaveBeenCalledWith('Mobile sign-in failed', {
    code: 'AUTHENTICATION_FAILED', httpStatus: 200, retryable: false,
  });
  expect(view.result.current).toMatchObject({ step: 'OTP', otp: '', newPassword: PASSWORD, confirmPassword: PASSWORD });
  expect(view.result.current.otpError).toBeTruthy();
  await enterOtp(view, '271828');
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(submittedCredentials()).toEqual({ otp: '271828', password: PASSWORD });
  expect(view.result.current.step).toBe('COMPLETE');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  view.unmount();
});

it.each([
  ['   ', '   ', 'newPasswordError', "can't be only spaces"],
  ['short', 'short', 'newPasswordError', 'at least 8 characters'],
  ['long enough', 'not matching', 'confirmPasswordError', 'do not match'],
])('keeps invalid password drafts on their own step with field errors', async (password, confirmation, field, message) => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view, password, confirmation);
  expect(view.result.current.isNewPasswordValid).toBe(false);
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(view.result.current.step).toBe('PASSWORD_OPTION');
  expect(view.result.current[field]).toContain(message);
  expect(client.complete).not.toHaveBeenCalled();
  view.unmount();
});

it('returns a rejected existing password to its password screen and clears the rejected value', async () => {
  connect('Both', { signedUp: true, hasPassword: true });
  const view = await mount();
  await start(view);
  act(() => view.result.current.setPassword(PASSWORD));
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  client.complete.mockRejectedValueOnce(new AuthError('INVALID_PASSWORD', 'untrusted', { httpStatus: 417 }));
  await enterOtp(view);
  expect(view.result.current).toMatchObject({ step: 'PASSWORD_SIGN_IN', password: '' });
  expect(view.result.current.passwordError).toContain('incorrect');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('preserves the transaction and countdown while going back through signup steps without resending', async () => {
  const view = await mount();
  jest.useFakeTimers();
  await start(view);
  const startedFlow = view.result.current.flow;
  await enterOtp(view);
  enterNewPassword(view);
  act(() => view.result.current.goBack());
  expect(view.result.current.step).toBe('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  act(() => view.result.current.goBack());
  expect(view.result.current).toMatchObject({ step: 'MOBILE', otp: '', newPassword: '', confirmPassword: '' });
  expect(view.result.current.flow).toBe(startedFlow);
  act(() => jest.advanceTimersByTime(5000));
  expect(view.result.current.resendSeconds).toBe(25);
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.step).toBe('OTP');
  expect(client.begin).toHaveBeenCalledTimes(1);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(view.result.current.resendSeconds).toBe(25);
  view.unmount();
});

it('invalidates signup secrets, policy and OTP timing when the mobile changes', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  act(() => view.result.current.setMobileNumber('+5550002'));
  expect(view.result.current).toMatchObject({
    step: 'MOBILE', flow: null, otp: '', password: '', newPassword: '', confirmPassword: '', otpSent: false, resendSeconds: 0,
  });
  await act(async () => { await view.result.current.begin(); });
  expect(client.begin).toHaveBeenLastCalledWith({ mobileNumber: '+5550002' });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('changes company without changing QR provisioning and discards the old flow secrets', async () => {
  await AsyncStorage.multiSet([['baseUrl', 'https://qr.example.test'], ['api_key', 'synthetic-qr-key']]);
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  await act(async () => { await view.result.current.changeCompany(); });
  expect(view.result.current).toMatchObject({
    step: 'MOBILE', flow: null, backendUrl: '', mobileNumber: '', otp: '', newPassword: '', confirmPassword: '', resendSeconds: 0,
  });
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  expect(await AsyncStorage.getItem('baseUrl')).toBe('https://qr.example.test');
  expect(await AsyncStorage.getItem('api_key')).toBe('synthetic-qr-key');
  view.unmount();
});

it('preserves manual resend countdown, caps it at 45 seconds, and makes no automatic retries', async () => {
  client.sendOtp.mockResolvedValue({ expiresIn: 300 });
  const view = await mount();
  jest.useFakeTimers();
  await start(view);
  expect(view.result.current.resendSeconds).toBe(45);
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(24000));
  expect(view.result.current.resendSeconds).toBe(21);
  act(() => jest.advanceTimersByTime(21000));
  expect(view.result.current.resendSeconds).toBe(0);
  client.sendOtp.mockRejectedValueOnce(new AuthError('TIMEOUT', 'untrusted send outcome', { retryable: false }));
  await act(async () => { await view.result.current.resendOtp(); });
  expect(view.result.current.step).toBe('OTP');
  expect(view.result.current.error).toContain('could not be confirmed');
  act(() => jest.advanceTimersByTime(90000));
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('opens recovery on OTP, stages the code, updates only the password, then begins a fresh SDK flow', async () => {
  connect('Optional', { signedUp: true });
  const view = await mount();
  await start(view);
  const oldFlow = view.result.current.flow;
  await act(async () => { await view.result.current.startCreatePassword(); });
  expect(view.result.current.step).toBe('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(view);
  expect(view.result.current.step).toBe('PASSWORD_CREATE');
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
  enterNewPassword(view);
  policy.employee_has_existing_password = true;
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.setPasswordWithOtp).toHaveBeenCalledWith({ mobileNumber: MOBILE, otp: OTP, newPassword: PASSWORD });
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(view.result.current.step).toBe('PASSWORD_SIGN_IN');
  expect(view.result.current.flow).not.toBe(oldFlow);
  expect(view.result.current).toMatchObject({ otp: '', newPassword: '', confirmPassword: '' });
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  view.unmount();
});

it('refreshes the policy snapshot after an unconfirmed password change without retrying the mutation', async () => {
  connect('Optional', { signedUp: true });
  const view = await mount();
  await start(view);
  await act(async () => { await view.result.current.startCreatePassword(); });
  await enterOtp(view);
  enterNewPassword(view);
  policy.employee_has_existing_password = true;
  client.setPasswordWithOtp.mockRejectedValueOnce(new AuthError('TIMEOUT', 'untrusted change outcome', { retryable: false }));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.setPasswordWithOtp).toHaveBeenCalledTimes(1);
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(view.result.current).toMatchObject({ step: 'PASSWORD_SIGN_IN', otp: '', newPassword: '', confirmPassword: '' });
  expect(view.result.current.error).toContain("couldn't confirm whether your password changed");
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('returns a refused recovery OTP to verification with its password draft and no resend', async () => {
  connect('Optional', { signedUp: true });
  const view = await mount();
  await start(view);
  await act(async () => { await view.result.current.startCreatePassword(); });
  await enterOtp(view);
  enterNewPassword(view);
  client.setPasswordWithOtp.mockRejectedValueOnce(new AuthError('INVALID_OR_EXPIRED_OTP', 'untrusted', { httpStatus: 417 }));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(view.result.current).toMatchObject({ step: 'OTP', otp: '', newPassword: PASSWORD, confirmPassword: PASSWORD });
  expect(view.result.current.otpError).toContain('invalid or expired');
  expect(client.begin).toHaveBeenCalledTimes(1);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  view.unmount();
});

it('keeps password-and-OTP reset forbidden and opens password-only reset on a dedicated OTP step', async () => {
  connect('Both', { signedUp: true, hasPassword: true });
  let view = await mount();
  await start(view);
  expect(view.result.current.canResetPassword).toBe(false);
  await act(async () => { await view.result.current.startResetPassword(); });
  expect(view.result.current.step).toBe('PASSWORD_SIGN_IN');
  expect(client.sendOtp).not.toHaveBeenCalled();
  view.unmount();

  connect('Password', { signedUp: true, hasPassword: true });
  view = await mount();
  await start(view);
  expect(view.result.current.canResetPassword).toBe(true);
  await act(async () => { await view.result.current.startResetPassword(); });
  expect(view.result.current.step).toBe('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('serializes Create and Skip taps while SDK completion is pending', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  const pending = deferred();
  client.complete.mockReturnValueOnce(pending.promise);
  let completion;
  act(() => {
    completion = view.result.current.submitNewPassword();
    view.result.current.skipPassword();
    view.result.current.submitNewPassword();
  });
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(view.result.current.isLoading).toBe(true);
  await act(async () => { pending.resolve({ status: 'authenticated' }); await completion; });
  expect(view.result.current.step).toBe('COMPLETE');
  expect(client.complete).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('ignores a late OTP send after changing the mobile number', async () => {
  const pending = deferred();
  client.sendOtp.mockReturnValueOnce(pending.promise);
  const view = await mount();
  act(() => view.result.current.setMobileNumber(MOBILE));
  let begin;
  act(() => { begin = view.result.current.begin(); });
  await waitFor(() => expect(client.sendOtp).toHaveBeenCalledTimes(1));
  act(() => view.result.current.setMobileNumber('+5550002'));
  await act(async () => { pending.resolve({ expiresIn: 30 }); await begin; });
  expect(view.result.current).toMatchObject({ step: 'MOBILE', flow: null, mobileNumber: '+5550002', otpSent: false, resendSeconds: 0 });
  view.unmount();
});

it('cancels a pending completion and clears secrets when the flow is cancelled', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  const pending = deferred();
  let options;
  completeMobileSignIn.mockImplementation(input => { options = input; return pending.promise; });
  let completion;
  act(() => { completion = view.result.current.submitNewPassword(); });
  expect(options.isCancelled()).toBe(false);
  await act(async () => { await view.result.current.cancelFlow(); });
  expect(options.isCancelled()).toBe(true);
  expect(view.result.current).toMatchObject({ step: 'MOBILE', flow: null, otp: '', newPassword: '', confirmPassword: '', resendSeconds: 0 });
  await act(async () => { pending.resolve({ status: 'authenticated' }); await completion; });
  expect(view.result.current.step).toBe('MOBILE');
  view.unmount();
});

it('cancels completion on unmount without invalidating the current session generation', async () => {
  connect('OTP', { signedUp: true });
  const view = await mount();
  await start(view);
  act(() => view.result.current.setOtp(OTP));
  const pending = deferred();
  let options;
  completeMobileSignIn.mockImplementation(input => { options = input; return pending.promise; });
  let completion;
  act(() => { completion = view.result.current.submitOtp(); });
  const generation = getAuthSessionGeneration();
  view.unmount();
  expect(options.isCancelled()).toBe(true);
  expect(getAuthSessionGeneration()).toBe(generation);
  await act(async () => { pending.resolve({ status: 'authenticated' }); await completion; });
});

it('never persists staged OTP or passwords, and remount starts without the prior credential draft', async () => {
  const view = await mount();
  await start(view);
  await enterOtp(view);
  enterNewPassword(view);
  act(() => view.result.current.setPassword('synthetic-existing-secret'));
  const keys = await AsyncStorage.getAllKeys();
  const stored = await AsyncStorage.multiGet(keys);
  expect(stored).toEqual([['backendUrl', BACKEND]]);
  const writes = JSON.stringify([AsyncStorage.setItem.mock.calls, AsyncStorage.multiSet.mock.calls]);
  expect(writes).not.toContain(OTP);
  expect(writes).not.toContain(PASSWORD);
  expect(writes).not.toContain('synthetic-existing-secret');
  view.unmount();
  const remounted = await mount();
  expect(remounted.result.current).toMatchObject({ step: 'MOBILE', flow: null, otp: '', password: '', newPassword: '', confirmPassword: '' });
  expect(client.begin).toHaveBeenCalledTimes(1);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  remounted.unmount();
});

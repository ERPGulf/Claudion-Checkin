import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import { AuthError } from '@erpgulf/auth-sdk';
import { lookupServer, ServerLookupError, ServerLookupConfigurationError } from '@erpgulf/server-lookup';
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
jest.mock('@erpgulf/server-lookup', () => ({
  ...jest.requireActual('@erpgulf/server-lookup'),
  lookupServer: jest.fn(),
}));

const backend = 'https://company.example.test';
const makeFlow = (step = 'ENTER_OTP_OPTIONAL_PASSWORD', overrides = {}) => ({
  action: 'SIGN_UP',
  nextStep: step,
  mobileNumber: '+5550001',
  credentials: {
    password: { requirement: step === 'ENTER_PASSWORD' ? 'required' : step === 'ENTER_OTP' ? 'disabled' : 'optional', purpose: step === 'ENTER_PASSWORD' ? 'existing' : step === 'ENTER_OTP' ? 'none' : 'create' },
    otp: { requirement: step === 'ENTER_PASSWORD' ? 'disabled' : 'required' },
  },
  capabilities: { canCreatePassword: false, canResetPassword: false },
  ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let client;
const rtlDescriptor = Object.getOwnPropertyDescriptor(I18nManager, 'isRTL');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: false });
  isMobileAuthAvailable.mockReturnValue(true);
  client = {
    begin: jest.fn().mockResolvedValue(makeFlow()),
    sendOtp: jest.fn().mockResolvedValue({ expiresIn: 30 }),
    complete: jest.fn().mockResolvedValue({ status: 'authenticated' }),
    setPasswordWithOtp: jest.fn().mockResolvedValue(undefined),
  };
  getMobileAuthClient.mockReturnValue(client);
  lookupServer.mockResolvedValue({ backendUrl: backend });
  completeMobileSignIn.mockImplementation(options => options.auth.complete(options.flow, options.credentials));
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (rtlDescriptor) Object.defineProperty(I18nManager, 'isRTL', rtlDescriptor);
});

const mount = async (storedUrl = '') => {
  if (storedUrl) await AsyncStorage.setItem('backendUrl', storedUrl);
  const view = renderHook(() => useMobileLogin());
  await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
  return view;
};
const enter = view => act(() => {
  view.result.current.setCompanyCode('  COMPANY +/  ');
  view.result.current.setMobileNumber('  +5550001  ');
});
const start = async view => {
  enter(view);
  await act(async () => { await view.result.current.begin(); });
};

it('reports employee-policy failure after OTP sign-in without blaming or resending the code', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_OTP', { action: 'SIGN_IN' }));
  const failure = Object.assign(new Error('Synthetic employee endpoint timeout'), { code: 'MOBILE_POLICY_UNAVAILABLE' });
  completeMobileSignIn.mockRejectedValue(failure);
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  expect(view.result.current.error).toBe('Your attendance settings could not be loaded. Please contact your administrator.');
  expect(view.result.current.step).toBe('OTP');
  expect(view.result.current.otp).toBe('123456');
  expect(view.result.current.otpError).toBe('');
  expect(view.result.current.isLoading).toBe(false);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(console.log).toHaveBeenCalledWith('Mobile sign-in failed', {
    code: 'MOBILE_POLICY_UNAVAILABLE', httpStatus: undefined, retryable: undefined,
  });
  const details = JSON.parse(console.log.mock.calls.find(([event]) => event === '[mobile-auth] operation.failed')[1]);
  expect(details.error).toMatchObject({ code: 'MOBILE_POLICY_UNAVAILABLE', message: failure.message });
  expect(details.error.stack).toContain(failure.message);
  expect(JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()))).not.toContain('123456');
  view.unmount();
});

it('keeps release failure logs code-only even when an error carries credentials', async () => {
  const previousDev = global.__DEV__;
  let view;
  global.__DEV__ = false;
  try {
    client.begin.mockResolvedValue(makeFlow('ENTER_OTP', { action: 'SIGN_IN' }));
    completeMobileSignIn.mockRejectedValue(Object.assign(new Error('Synthetic private detail'), {
      code: 'MOBILE_POLICY_UNAVAILABLE', otp: '123456', password: 'synthetic-password',
    }));
    view = await mount(backend);
    await start(view);
    act(() => view.result.current.setOtp('123456'));
    await act(async () => { await view.result.current.submitOtp(); });
    expect(console.log.mock.calls).toEqual([['Mobile sign-in failed', {
      code: 'MOBILE_POLICY_UNAVAILABLE', httpStatus: undefined, retryable: undefined,
    }]]);
  } finally {
    view?.unmount();
    global.__DEV__ = previousDev;
  }
});

it('looks up a normalized company once, begins before persisting its URL, and sends the required OTP once', async () => {
  await AsyncStorage.setItem('baseUrl', 'https://previous-qr.example.test');
  const view = await mount();
  enter(view);
  const pending = deferred();
  client.begin.mockReturnValue(pending.promise);
  let begin;
  act(() => { begin = view.result.current.begin(); });
  await waitFor(() => expect(client.begin).toHaveBeenCalledWith({ mobileNumber: '+5550001' }));
  expect(lookupServer).toHaveBeenCalledTimes(1);
  expect(lookupServer).toHaveBeenCalledWith('COMPANY +/', expect.objectContaining({ config: expect.any(Object) }));
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  await act(async () => { pending.resolve(makeFlow()); await begin; });
  expect(await AsyncStorage.getItem('backendUrl')).toBe(backend);
  expect(await AsyncStorage.getItem('baseUrl')).toBe('https://previous-qr.example.test');
  expect(await AsyncStorage.getItem('company_code')).toBeNull();
  expect(view.result.current.companyCode).toBe('');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(client.sendOtp).toHaveBeenCalledWith({ mobileNumber: '+5550001' });
  expect(view.result.current.resendSeconds).toBe(30);
  view.unmount();
});

it('skips lookup and its configuration entirely when backendUrl is already stored', async () => {
  const view = await mount(backend);
  act(() => view.result.current.setMobileNumber('+5550001'));
  await act(async () => { await view.result.current.begin(); });
  expect(lookupServer).not.toHaveBeenCalled();
  expect(getMobileAuthClient).toHaveBeenCalledWith(backend);
  view.unmount();
});

it('uses a typed server address instead of lookup and persists its origin only after begin', async () => {
  const view = await mount();
  act(() => {
    view.result.current.setDiscovery('server');
    view.result.current.setServerAddress('  erp.example.test/app/home  ');
    view.result.current.setMobileNumber('+5550001');
  });
  const pending = deferred();
  client.begin.mockReturnValue(pending.promise);
  let begin;
  act(() => { begin = view.result.current.begin(); });
  await waitFor(() => expect(client.begin).toHaveBeenCalledWith({ mobileNumber: '+5550001' }));
  expect(lookupServer).not.toHaveBeenCalled();
  expect(getMobileAuthClient).toHaveBeenCalledWith('https://erp.example.test');
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  await act(async () => { pending.resolve(makeFlow()); await begin; });
  expect(await AsyncStorage.getItem('backendUrl')).toBe('https://erp.example.test');
  expect(view.result.current.serverAddress).toBe('');
  view.unmount();
});

it.each([
  ['', 'Enter the server address.'],
  ['not a server', "That address doesn't look right."],
  ['http://erp.example.test', 'must use https'],
])('rejects the server address %j at the field without any request', async (address, expected) => {
  const view = await mount();
  act(() => {
    view.result.current.setDiscovery('server');
    view.result.current.setServerAddress(address);
    view.result.current.setMobileNumber('+5550001');
  });
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.serverAddressError).toContain(expected);
  expect(lookupServer).not.toHaveBeenCalled();
  expect(getMobileAuthClient).not.toHaveBeenCalled();
  view.unmount();
});

it('blames the typed address, not the setup service, when that server cannot be reached', async () => {
  client.begin.mockRejectedValue(new AuthError('NETWORK_ERROR', 'not-for-consumers', { retryable: true }));
  const view = await mount();
  act(() => {
    view.result.current.setDiscovery('server');
    view.result.current.setServerAddress('erp.example.test');
    view.result.current.setMobileNumber('+5550001');
  });
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.error).toContain("couldn't connect to that server");
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  view.unmount();
});

it('does not look up blank/oversize codes or call begin for an empty mobile number', async () => {
  const view = await mount();
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.mobileNumberError).toBe('Enter your mobile number.');
  act(() => view.result.current.setMobileNumber('+5550001'));
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.companyCodeError).toBe('Enter your company code.');
  act(() => view.result.current.setCompanyCode('x'.repeat(129)));
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.companyCodeError).toContain('too long');
  expect(lookupServer).not.toHaveBeenCalled();
  expect(client.begin).not.toHaveBeenCalled();
  view.unmount();
});

it.each([
  [() => new ServerLookupConfigurationError(['secret']), 'Setup is not configured correctly'],
  [() => new ServerLookupError('notFound'), "couldn't find that company code"],
  [() => new ServerLookupError('unavailable'), "couldn't connect to the setup service"],
  [() => new ServerLookupError('invalidResponse'), 'returned an invalid response'],
])('maps named lookup errors to app copy without retries', async (makeError, expected) => {
  lookupServer.mockRejectedValue(makeError());
  const view = await mount();
  await start(view);
  expect(view.result.current.error).toContain(expected);
  expect(lookupServer).toHaveBeenCalledTimes(1);
  expect(getMobileAuthClient).not.toHaveBeenCalled();
  view.unmount();
});

it('provides Arabic lookup copy and rethrows unknown lookup failures', async () => {
  Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
  lookupServer.mockRejectedValueOnce(new ServerLookupError('notFound'));
  const view = await mount();
  await start(view);
  expect(view.result.current.error).toContain('رمز الشركة');
  const unknown = new Error('unexpected lookup failure');
  lookupServer.mockRejectedValueOnce(unknown);
  await act(async () => { await expect(view.result.current.begin()).rejects.toBe(unknown); });
  expect(view.result.current.isLoading).toBe(false);
  view.unmount();
});

it('rethrows an unexpected SDK error from lookup while preserving its debug details', async () => {
  const unexpected = new AuthError('SERVER_ERROR', 'untrusted lookup exception');
  lookupServer.mockRejectedValue(unexpected);
  const view = await mount();
  enter(view);
  await act(async () => { await expect(view.result.current.begin()).rejects.toBe(unexpected); });
  expect(view.result.current.error).toBe('');
  expect(view.result.current.isLoading).toBe(false);
  expect(console.log.mock.calls.some(([label]) => label === 'Mobile sign-in failed')).toBe(false);
  expect(JSON.stringify(console.log.mock.calls)).toContain('untrusted lookup exception');
  expect(getMobileAuthClient).not.toHaveBeenCalled();
  view.unmount();
});

it('never sends OTP for a password-only flow and omits disabled credentials while preserving password bytes', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD', { action: 'SIGN_IN' }));
  const view = await mount(backend);
  await start(view);
  expect(client.sendOtp).not.toHaveBeenCalled();
  act(() => {
    view.result.current.setPassword('  exact password bytes  ');
    view.result.current.setOtp('hidden-stale-otp');
  });
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  expect(completeMobileSignIn).toHaveBeenCalledWith(expect.objectContaining({
    credentials: { password: '  exact password bytes  ' }, baseUrl: backend, dispatch: mockDispatch,
  }));
  expect(view.result.current.password).toBe('');
  expect(view.result.current.otp).toBe('');
  view.unmount();
});

it('omits an untouched optional password and validates required OTP before completing', async () => {
  const view = await mount(backend);
  await start(view);
  await act(async () => { await view.result.current.submitOtp(); });
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(view.result.current.error).toBe('Enter the OTP.');
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  expect(view.result.current.step).toBe('PASSWORD_OPTION');
  await act(async () => { await view.result.current.skipPassword(); });
  expect(completeMobileSignIn.mock.calls[0][0].credentials).toEqual({ otp: '123456' });
  view.unmount();
});

it('requires a resolved existing password even when the raw policy is Optional / Optional', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD', {
    action: 'SIGN_IN',
    capabilities: { canCreatePassword: false, canResetPassword: true },
    policy: {
      passwordPolicy: 'optional', otpPolicy: 'optional', employeeHasExistingPassword: true, employeeHasSignedUp: true,
      signInPolicy: { passwordPolicy: 'optional', otpPolicy: 'optional' },
    },
  }));
  const view = await mount(backend);
  await start(view);
  expect(client.sendOtp).not.toHaveBeenCalled();
  act(() => view.result.current.setOtp('123456')); // a code cannot stand in for the password
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  expect(view.result.current.error).toBe('Enter your password.');
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  act(() => view.result.current.setPassword('known password'));
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  expect(completeMobileSignIn.mock.calls[0][0].credentials).toEqual({ password: 'known password' });
  view.unmount();
});

it('strips whitespace a paste brings into the code, never from a password', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD_AND_OTP', {
    action: 'SIGN_IN', credentials: { password: { requirement: 'required', purpose: 'existing' }, otp: { requirement: 'required' } },
  }));
  const view = await mount(backend);
  await start(view);
  act(() => { view.result.current.setOtp(' 123 456 '); view.result.current.setPassword(' pass word '); });
  expect(view.result.current.otp).toBe('123456');
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  await act(async () => { await view.result.current.submitOtp(); });
  expect(completeMobileSignIn.mock.calls[0][0].credentials).toEqual({ password: ' pass word ', otp: '123456' });
  view.unmount();
});

it.each(['MASTER_TOKEN_FAILED', 'MASTER_TOKEN_REJECTED'])('reports %s as the service being unavailable, not the employee', async code => {
  client.begin.mockRejectedValue(new AuthError(code, 'untrusted server text', { httpStatus: 503 }));
  const view = await mount(backend);
  await start(view);
  expect(view.result.current.error).toContain('sign-in service is unavailable');
  view.unmount();
});

it.each([
  ['ENTER_OTP_OPTIONAL_PASSWORD', '   ', '   ', "can't be only spaces"],
  ['ENTER_OTP_OPTIONAL_PASSWORD', 'short', 'short', 'at least 8 characters'],
  ['CREATE_PASSWORD_AND_ENTER_OTP', 'long enough', 'long enougj', 'do not match'],
])('refuses a %s password %j that breaks the new-password rules', async (step, password, confirmation, expected) => {
  client.begin.mockResolvedValue(makeFlow(step, step === 'CREATE_PASSWORD_AND_ENTER_OTP'
    ? { credentials: { password: { requirement: 'required', purpose: 'create' }, otp: { requirement: 'required' } } }
    : {}));
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  act(() => {
    view.result.current.setNewPassword(password);
    view.result.current.setConfirmPassword(confirmation);
  });
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(view.result.current.error).toContain(expected);
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  act(() => {
    view.result.current.setNewPassword('  chosen bytes  ');
    view.result.current.setConfirmPassword('  chosen bytes  ');
  });
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(completeMobileSignIn.mock.calls[0][0].credentials).toEqual({ password: '  chosen bytes  ', otp: '123456' });
  view.unmount();
});

it('obeys expiresIn for manual resend and never repeats a failed OTP automatically', async () => {
  const view = await mount(backend);
  jest.useFakeTimers();
  await start(view);
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(30000));
  expect(view.result.current.resendSeconds).toBe(0);
  client.sendOtp.mockRejectedValue(new AuthError('TIMEOUT', 'sensitive server text', { retryable: false }));
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  act(() => jest.advanceTimersByTime(60000));
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  expect(view.result.current.error).toContain('could not be confirmed');
  expect(console.log).toHaveBeenCalledWith('Mobile sign-in failed', { code: 'TIMEOUT', httpStatus: undefined, retryable: false });
  expect(JSON.stringify(console.log.mock.calls)).toContain('sensitive server text');
  view.unmount();
});

it('caps the resend cooldown at 45 seconds when the code lives longer', async () => {
  client.sendOtp.mockResolvedValue({ expiresIn: 300 });
  const view = await mount(backend);
  jest.useFakeTimers();
  await start(view);
  expect(view.result.current.resendSeconds).toBe(45);
  act(() => jest.advanceTimersByTime(45000));
  expect(view.result.current.resendSeconds).toBe(0);
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('never offers reset on a password-and-OTP step, nor password help outside sign-in', async () => {
  const both = { password: { requirement: 'required', purpose: 'existing' }, otp: { requirement: 'required' } };
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD_AND_OTP', {
    action: 'SIGN_IN', credentials: both, capabilities: { canCreatePassword: false, canResetPassword: true },
  }));
  const view = await mount(backend);
  await start(view);
  expect(view.result.current.canResetPassword).toBe(false);
  await act(async () => { await view.result.current.startResetPassword(); });
  expect(view.result.current.passwordMode).toBeNull();
  expect(client.sendOtp).not.toHaveBeenCalled();

  client.begin.mockResolvedValue(makeFlow('ENTER_OTP_OPTIONAL_PASSWORD', {
    capabilities: { canCreatePassword: true, canResetPassword: true },
  }));
  act(() => view.result.current.cancelFlow());
  await act(async () => { await view.result.current.begin(); });
  expect(view.result.current.canCreatePassword).toBe(false);
  expect(view.result.current.canResetPassword).toBe(false);
  view.unmount();
});

const openCreatePassword = async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_OTP', {
    action: 'SIGN_IN', capabilities: { canCreatePassword: true, canResetPassword: false },
  }));
  const view = await mount(backend);
  await start(view);
  await act(async () => { await view.result.current.startCreatePassword(); });
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  act(() => {
    view.result.current.setNewPassword('new secret bytes');
    view.result.current.setConfirmPassword('new secret bytes');
  });
  return view;
};

it('treats an unconfirmed password change as applied and begins a fresh flow', async () => {
  const view = await openCreatePassword();
  const stale = view.result.current.flow;
  const fresh = makeFlow('ENTER_PASSWORD', { action: 'SIGN_IN' });
  client.begin.mockResolvedValue(fresh);
  client.setPasswordWithOtp.mockRejectedValue(new AuthError('TIMEOUT', 'untrusted outcome', { retryable: false }));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(view.result.current.flow).toBe(fresh);
  expect(view.result.current.flow).not.toBe(stale);
  expect(view.result.current.passwordMode).toBeNull();
  expect(view.result.current.error).toContain("couldn't confirm whether your password changed");
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  view.unmount();
});

it.each([
  ['INVALID_PASSWORD', "can't be used", { otp: '123456', newPassword: '', confirmPassword: '' }],
  ['INVALID_OR_EXPIRED_OTP', 'invalid or expired', { otp: '', newPassword: 'new secret bytes', confirmPassword: 'new secret bytes' }],
  ['MASTER_TOKEN_REJECTED', 'sign-in service is unavailable', { otp: '123456', newPassword: 'new secret bytes', confirmPassword: 'new secret bytes' }],
])('keeps the flow after a refused password change (%s) and clears only the rejected field', async (code, expected, fields) => {
  const view = await openCreatePassword();
  const flow = view.result.current.flow;
  client.setPasswordWithOtp.mockRejectedValue(new AuthError(code, 'untrusted server text', { httpStatus: 417 }));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.begin).toHaveBeenCalledTimes(1);
  expect(view.result.current.flow).toBe(flow);
  expect(view.result.current.passwordMode).toBe('create');
  expect(view.result.current.error).toContain(expected);
  expect(view.result.current).toMatchObject(fields);
  view.unmount();
});

it('clears the rejected OTP or password after a failed sign-in', async () => {
  const both = { password: { requirement: 'required', purpose: 'existing' }, otp: { requirement: 'required' } };
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD_AND_OTP', { action: 'SIGN_IN', credentials: both }));
  const view = await mount(backend);
  await start(view);
  act(() => { view.result.current.setPassword('known password'); view.result.current.setOtp('111111'); });
  await act(async () => { await view.result.current.continuePasswordSignIn(); });
  client.complete.mockRejectedValueOnce(new AuthError('INVALID_OR_EXPIRED_OTP', 'untrusted', { httpStatus: 417 }));
  await act(async () => { await view.result.current.submitOtp(); });
  expect(view.result.current).toMatchObject({ otp: '', password: 'known password' });
  expect(view.result.current.error).toContain('invalid or expired');
  act(() => view.result.current.setOtp('222222'));
  client.complete.mockRejectedValueOnce(new AuthError('INVALID_PASSWORD', 'untrusted', { httpStatus: 417 }));
  await act(async () => { await view.result.current.submitOtp(); });
  expect(view.result.current).toMatchObject({ otp: '222222', password: '' });
  expect(view.result.current.error).toContain('password is incorrect');
  view.unmount();
});

it.each(['create', 'reset'])('gates %s password capability, updates the password, then begins again without signing in', async mode => {
  const view = await mount(backend);
  await start(view);
  await act(async () => {
    await (mode === 'create' ? view.result.current.startCreatePassword() : view.result.current.startResetPassword());
  });
  expect(view.result.current.passwordMode).toBeNull();
  client.begin.mockResolvedValue(makeFlow('ENTER_PASSWORD', {
    action: 'SIGN_IN', capabilities: { canCreatePassword: mode === 'create', canResetPassword: mode === 'reset' },
  }));
  act(() => view.result.current.cancelFlow());
  await act(async () => { await view.result.current.begin(); });
  await act(async () => {
    await (mode === 'create' ? view.result.current.startCreatePassword() : view.result.current.startResetPassword());
  });
  expect(view.result.current.passwordMode).toBe(mode);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  act(() => view.result.current.setNewPassword('  new secret bytes  '));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(view.result.current.error).toContain('do not match');
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
  act(() => view.result.current.setConfirmPassword('  new secret bytes  '));
  await act(async () => { await view.result.current.submitNewPassword(); });
  expect(client.setPasswordWithOtp).toHaveBeenCalledWith({ mobileNumber: '+5550001', otp: '123456', newPassword: '  new secret bytes  ' });
  expect(client.begin).toHaveBeenCalledTimes(3);
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(view.result.current.passwordMode).toBeNull();
  expect(view.result.current.newPassword).toBe('');
  view.unmount();
});

it('opening password recovery after its existing OTP cooldown expires waits for a manual resend', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_OTP', {
    action: 'SIGN_IN', capabilities: { canCreatePassword: true, canResetPassword: false },
  }));
  const view = await mount(backend);
  jest.useFakeTimers();
  await start(view);
  act(() => jest.advanceTimersByTime(30000));
  await act(async () => { await view.result.current.startCreatePassword(); });
  expect(view.result.current.passwordMode).toBe('create');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('opening password recovery after an unconfirmed initial OTP does not resend without an explicit tap', async () => {
  client.begin.mockResolvedValue(makeFlow('ENTER_OTP', {
    action: 'SIGN_IN', capabilities: { canCreatePassword: true, canResetPassword: false },
  }));
  client.sendOtp.mockRejectedValueOnce(new AuthError('TIMEOUT', 'untrusted send outcome', { retryable: false }));
  const view = await mount(backend);
  await start(view);
  expect(view.result.current.otpSent).toBe(false);
  expect(view.result.current.error).toContain('could not be confirmed');
  await act(async () => { await view.result.current.startCreatePassword(); });
  expect(view.result.current.passwordMode).toBe('create');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await act(async () => { await view.result.current.resendOtp(); });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('never retries a nonretryable completion or accepts a simultaneous double submission', async () => {
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  const pending = deferred();
  client.complete.mockReturnValue(pending.promise);
  let first;
  act(() => {
    first = view.result.current.skipPassword();
    view.result.current.skipPassword();
  });
  expect(client.complete).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.reject(new AuthError('NETWORK_ERROR', 'not-for-consumers', { retryable: false }));
    await first;
  });
  expect(view.result.current.error).toContain('could not be confirmed');
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(console.log.mock.calls)).toContain('not-for-consumers');
  view.unmount();
});

it('ignores a late OTP response after changing company', async () => {
  const pending = deferred();
  client.sendOtp.mockReturnValue(pending.promise);
  const view = await mount(backend);
  enter(view);
  let begin;
  act(() => { begin = view.result.current.begin(); });
  await waitFor(() => expect(client.sendOtp).toHaveBeenCalledTimes(1));
  await act(async () => { await view.result.current.changeCompany(); });
  await act(async () => { pending.resolve({ expiresIn: 90 }); await begin; });
  expect(view.result.current.otpSent).toBe(false);
  expect(view.result.current.resendSeconds).toBe(0);
  expect(view.result.current.backendUrl).toBe('');
  expect(view.result.current.flow).toBeNull();
  view.unmount();
});

it('marks an unmounted completion cancelled without invalidating a newly established session', async () => {
  let completionOptions;
  const pending = deferred();
  completeMobileSignIn.mockImplementation(options => { completionOptions = options; return pending.promise; });
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  let completion;
  act(() => { completion = view.result.current.skipPassword(); });
  const generation = getAuthSessionGeneration();
  view.unmount();
  expect(completionOptions.isCancelled()).toBe(true);
  expect(getAuthSessionGeneration()).toBe(generation);
  await act(async () => { pending.resolve({ status: 'authenticated' }); await completion; });
});

it('changing company cancels a pending lookup and clears only the URL preference', async () => {
  await AsyncStorage.multiSet([['baseUrl', 'https://qr.example.test'], ['api_key', 'previous-key']]);
  const pending = deferred();
  lookupServer.mockReturnValue(pending.promise);
  const view = await mount();
  enter(view);
  let begin;
  act(() => { begin = view.result.current.begin(); });
  await act(async () => { await view.result.current.changeCompany(); });
  await act(async () => { pending.resolve({ backendUrl: backend }); await begin; });
  expect(client.begin).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  expect(await AsyncStorage.getItem('baseUrl')).toBe('https://qr.example.test');
  expect(await AsyncStorage.getItem('api_key')).toBe('previous-key');
  expect(view.result.current.flow).toBeNull();
  view.unmount();
});

it('changing company invalidates an in-progress completion and prevents stale handoff', async () => {
  const pending = deferred();
  let completionOptions;
  completeMobileSignIn.mockImplementation(options => { completionOptions = options; return pending.promise; });
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.submitOtp(); });
  const generation = getAuthSessionGeneration();
  let completion;
  act(() => { completion = view.result.current.skipPassword(); });
  expect(completionOptions.isCancelled()).toBe(false);
  await act(async () => { await view.result.current.changeCompany(); });
  expect(completionOptions.isCancelled()).toBe(true);
  expect(getAuthSessionGeneration()).toBeGreaterThan(generation);
  await act(async () => { pending.resolve({ status: 'authenticated' }); await completion; });
  expect(view.result.current.flow).toBeNull();
  expect(view.result.current.otp).toBe('');
  expect(await AsyncStorage.getItem('backendUrl')).toBeNull();
  view.unmount();
});

it('makes no requests when native crypto is unavailable', async () => {
  isMobileAuthAvailable.mockReturnValue(false);
  const view = await mount();
  await start(view);
  expect(view.result.current.isAvailable).toBe(false);
  expect(lookupServer).not.toHaveBeenCalled();
  expect(client.begin).not.toHaveBeenCalled();
  view.unmount();
});

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

it('rethrows an unexpected SDK error from lookup without classifying or logging it', async () => {
  const unexpected = new AuthError('SERVER_ERROR', 'untrusted lookup exception');
  lookupServer.mockRejectedValue(unexpected);
  const view = await mount();
  enter(view);
  await act(async () => { await expect(view.result.current.begin()).rejects.toBe(unexpected); });
  expect(view.result.current.error).toBe('');
  expect(view.result.current.isLoading).toBe(false);
  expect(console.log).not.toHaveBeenCalled();
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
  await act(async () => { await view.result.current.complete(); });
  expect(completeMobileSignIn).toHaveBeenCalledWith(expect.objectContaining({
    credentials: { password: '  exact password bytes  ' }, baseUrl: backend, dispatch: mockDispatch,
  }));
  expect(view.result.current.password).toBe('');
  expect(view.result.current.otp).toBe('');
  view.unmount();
});

it('omits optional blank password and validates required OTP before completing', async () => {
  const view = await mount(backend);
  await start(view);
  act(() => view.result.current.setPassword('   '));
  await act(async () => { await view.result.current.complete(); });
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(view.result.current.error).toBe('Enter the OTP.');
  act(() => view.result.current.setOtp('123456'));
  await act(async () => { await view.result.current.complete(); });
  expect(completeMobileSignIn.mock.calls[0][0].credentials).toEqual({ otp: '123456' });
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
  expect(JSON.stringify(console.log.mock.calls)).not.toContain('sensitive server text');
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
  await act(async () => { await view.result.current.begin(); });
  await act(async () => {
    await (mode === 'create' ? view.result.current.startCreatePassword() : view.result.current.startResetPassword());
  });
  expect(view.result.current.passwordMode).toBe(mode);
  act(() => { view.result.current.setOtp('123456'); view.result.current.setNewPassword('  new secret bytes  '); });
  await act(async () => { await view.result.current.savePassword(); });
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
  const pending = deferred();
  client.complete.mockReturnValue(pending.promise);
  let first;
  act(() => {
    first = view.result.current.complete();
    view.result.current.complete();
  });
  expect(client.complete).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.reject(new AuthError('NETWORK_ERROR', 'not-for-consumers', { retryable: false }));
    await first;
  });
  expect(view.result.current.error).toContain('could not be confirmed');
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(console.log.mock.calls)).not.toContain('not-for-consumers');
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
  let completion;
  act(() => { completion = view.result.current.complete(); });
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
  const generation = getAuthSessionGeneration();
  let completion;
  act(() => { completion = view.result.current.complete(); });
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

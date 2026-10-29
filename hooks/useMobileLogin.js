import { t, useTranslation } from "../localization";
import { useEffect, useRef, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import { isAuthError } from '@erpgulf/auth-sdk';
import {
  lookupServer,
  normalizeBackendUrl,
  normalizeCompanyCode,
  validateBackendUrl,
  validateCompanyCode,
  ServerLookupError,
  ServerLookupConfigurationError,
} from '@erpgulf/server-lookup';
import {
  getMobileAuthClient,
  completeMobileSignIn,
} from '../services/api/mobileAuth.service';
import { invalidateAuthSession } from '../utils/authSessionGuard';
import { isMobileAuthAvailable } from '../utils/mobileAuthCrypto';
import { MOBILE_AUTH_STEPS as STEPS, initialMobileAuthStep, signupPasswordStep } from '../utils/mobileAuthFlow';
import { logMobileAuthDebug } from '../utils/mobileAuthDebug';


// Client-side resend cooldown, independent of the code's own lifetime (often
// minutes); a code that expires sooner may be resent as soon as it does.
const RESEND_SECONDS = 45;
const MIN_PASSWORD_LENGTH = 8;
// A dispatched mutation the SDK marks non-retryable may already have applied.
const UNCONFIRMED_CODES = new Set(['TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR', 'INVALID_RESPONSE']);
const passwordChangeUnconfirmed = error =>
  !isAuthError(error) || (!error.retryable && UNCONFIRMED_CODES.has(error.code));

/** Rules for a password the employee is choosing, never for one they already have. */
function newPasswordError(value, confirmation) {
  if (!value.trim()) return "Password can't be only spaces.";
  if (value.length < MIN_PASSWORD_LENGTH) return "Password must be at least 8 characters.";
  if (value !== confirmation) return "Passwords do not match.";
  return '';
}

function lookupErrorCopy(error) {
  if (error instanceof ServerLookupConfigurationError) {
    return "Setup is not configured correctly in this app. Please contact support.";
  }
  if (!(error instanceof ServerLookupError)) return null;
  switch (error.kind) {
    case 'notFound':
      return "We couldn't find that company code. Check the code and try again.";
    case 'unavailable':
      return "We couldn't connect to the setup service. Check your internet connection and try again.";
    default:
      return "The setup service returned an invalid response. Please try again or contact support.";
  }
}

// A typed address fails in ways a looked-up one does not: a typo'd host is a
// network error, and a reachable non-Frappe host answers 404.
const MANUAL_SERVER_FAILURES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'INVALID_RESPONSE', 'INVALID_BASE_URL', 'MASTER_TOKEN_FAILED', 'MASTER_TOKEN_REJECTED']);

function serverAddressIssueCopy(issue) {
  switch (issue) {
    case 'required':
      return "Enter the server address.";
    case 'insecure':
      return "The server address must use https.";
    default:
      return "That address doesn't look right. Check it and try again.";
  }
}

function authErrorCopy(error, phase) {
  if (phase === 'password' && error.code === 'INVALID_PASSWORD') {
    return "That password can't be used. Try a different one.";
  }
  if (phase === 'password' && error.code === 'AUTHENTICATION_FAILED') {
    return "We couldn't change your password. Check the code and try again.";
  }
  switch (error.code) {
    case 'INVALID_BASE_URL':
      return "The setup service returned an invalid response. Please try again or contact support.";
    case 'INVALID_OR_EXPIRED_OTP':
      return "The OTP is invalid or expired. Check it or request a new code.";
    case 'INVALID_PASSWORD':
      return "The password is incorrect. Please try again.";
    case 'INVALID_MOBILE':
      return "Enter your mobile number.";
    case 'UNSUPPORTED_POLICY':
    case 'INVALID_RESPONSE':
      return "Sign-in is not available for this account. Please contact support.";
    case 'INVALID_CLIENT_CONFIG':
    case 'MOBILE_AUTH_UNAVAILABLE':
      return "Mobile sign-in is unavailable in this app build. Please update the app.";
    case 'MOBILE_IDENTITY_UNVERIFIED':
      return "Your employee profile could not be verified. Please contact your administrator.";
    case 'MOBILE_POLICY_UNAVAILABLE':
      return "Your attendance settings could not be loaded. Please contact your administrator.";
    case 'MOBILE_SESSION_INCOMPLETE':
      return "The sign-in service returned an incomplete session. Please contact support.";
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return error.retryable
        ? "The server could not be reached. Check your connection and try again."
        : "The request could not be confirmed. Check before submitting again; an OTP may already have been used.";
    // The SDK's own service credential failed; nothing the employee entered.
    case 'MASTER_TOKEN_FAILED':
    case 'MASTER_TOKEN_REJECTED':
      return "The sign-in service is unavailable right now. Please try again shortly.";
    default:
      return "Sign-in was not successful. Check your details or contact support.";
  }
}

/** Company discovery and SDK forms remain separate from the established QR login. */
export default function useMobileLogin() {
  useTranslation();
  const dispatch = useDispatch();
  const [backendUrl, setBackendUrl] = useState('');
  const [companyCode, setCompanyCodeState] = useState('');
  const [discovery, setDiscoveryState] = useState('company');
  const [serverAddress, setServerAddressState] = useState('');
  const [mobileNumber, setMobileNumberState] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [flow, setFlow] = useState(null);
  const [step, setStep] = useState(STEPS.MOBILE);
  const stepRef = useRef(STEPS.MOBILE);
  const [passwordMode, setPasswordMode] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState('');
  const [companyCodeError, setCompanyCodeError] = useState('');
  const [serverAddressError, setServerAddressError] = useState('');
  const [mobileNumberError, setMobileNumberError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [newPasswordFieldError, setNewPasswordFieldError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendDeadline, setResendDeadline] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(null);
  const otpAttempted = useRef(false);
  const sequence = useRef(0);
  const preferenceWrites = useRef(Promise.resolve());

  const isCurrent = pending => mounted.current && operation.current === pending;
  const moveTo = next => {
    logMobileAuthDebug('step', {
      from: stepRef.current, to: next, backendUrl, mobileNumber,
      action: flow?.action, passwordMode, otpSent, resendSeconds,
      previousCredentials: { password, otp, newPassword, confirmPassword },
    });
    stepRef.current = next;
    setStep(next);
  };
  const clearFieldErrors = () => {
    setPasswordError('');
    setNewPasswordFieldError('');
    setConfirmPasswordError('');
    setOtpError('');
  };
  const clearSecrets = () => {
    logMobileAuthDebug('credentials.clear');
    setPassword('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    clearFieldErrors();
  };
  // Password help belongs to sign-in only, and reset never to a password + OTP
  // step: a code-only reset would bypass the password that step demands.
  const signingIn = flow?.action === 'SIGN_IN';
  const canCreatePassword = signingIn && flow.capabilities.canCreatePassword;
  const canResetPassword = signingIn && flow.capabilities.canResetPassword && flow.nextStep !== 'ENTER_PASSWORD_AND_OTP';
  const clearFlow = () => {
    otpAttempted.current = false;
    setFlow(null);
    setPasswordMode(null);
    setOtpSent(false);
    setResendDeadline(0);
    setResendSeconds(0);
    clearSecrets();
    moveTo(STEPS.MOBILE);
  };
  const cancelCurrent = () => {
    logMobileAuthDebug('operation.cancel', { operation: operation.current, step: stepRef.current });
    if (operation.current?.kind === 'complete') invalidateAuthSession();
    operation.current = null;
    setIsLoading(false);
  };
  const writePreference = task => {
    // A company change must remove any earlier in-flight preference write last.
    const next = preferenceWrites.current.catch(() => {}).then(task);
    preferenceWrites.current = next;
    return next;
  };

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem('backendUrl')
      .then(stored => {
        if (mounted.current && stored) setBackendUrl(stored);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted.current) setIsHydrating(false);
      });
    return () => {
      mounted.current = false;
      operation.current = null;
    };
  }, []);

  useEffect(() => {
    if (!resendDeadline) return undefined;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendDeadline]);

  const run = async (kind, task) => {
    if (operation.current || isHydrating || !isMobileAuthAvailable()) {
      logMobileAuthDebug('operation.blocked', { kind, operation: operation.current, isHydrating });
      return;
    }
    const pending = { id: ++sequence.current, kind, phase: kind };
    operation.current = pending;
    setIsLoading(true);
    setError('');
    logMobileAuthDebug('operation.start', {
      operation: pending, step: stepRef.current, backendUrl, mobileNumber, flow, passwordMode,
      credentials: { password, otp, newPassword, confirmPassword }, otpSent, resendSeconds,
                                                                           });
    try {
      const result = await task(pending);
      logMobileAuthDebug('operation.result', { operation: pending, current: isCurrent(pending), result });
      return result;
    } catch (caught) {
      logMobileAuthDebug('operation.failed', {
        operation: pending, step: stepRef.current, current: isCurrent(pending),
        backendUrl, mobileNumber, error: caught,
                                });
      if (!isCurrent(pending)) return;
      const lookupCopy = lookupErrorCopy(caught);
      if (lookupCopy) {
        setError(lookupCopy);
      } else if (pending.phase === 'lookup') {
        throw caught;
      } else if (isAuthError(caught)) {
        console.log('Mobile sign-in failed', {
          code: caught.code,
          httpStatus: caught.httpStatus,
          retryable: caught.retryable,
        });
        // The rejected credential is cleared so the next attempt starts clean.
        const message = pending.phase === 'manual' && MANUAL_SERVER_FAILURES.has(caught.code)
          ? "We couldn't connect to that server. Check the address and try again."
          : authErrorCopy(caught, pending.phase);
        if (caught.code === 'INVALID_OR_EXPIRED_OTP' ||
          (caught.code === 'AUTHENTICATION_FAILED' && (flow?.action === 'SIGN_UP' || pending.phase === 'password'))) {
          setOtp('');
          setOtpError(message);
          moveTo(STEPS.OTP);
        }
        if (caught.code === 'INVALID_PASSWORD') {
          setPassword('');
          setNewPassword('');
          setConfirmPassword('');
          if (passwordMode || flow?.credentials.password.purpose === 'create') {
            setNewPasswordFieldError(message);
            moveTo(passwordMode ? STEPS.PASSWORD_CREATE : signupPasswordStep(flow));
          } else {
            setPasswordError(message);
            moveTo(STEPS.PASSWORD_SIGN_IN);
          }
        }
        setError(message);
      } else {
        // Hand-off errors are app-owned, not AuthError instances. Previously
        // these silently fell through to the generic banner with no diagnostics.
        console.log('Mobile sign-in failed', {
          code: caught?.code,
          httpStatus: caught?.httpStatus,
          retryable: caught?.retryable,
        });
        setError(typeof caught?.code === 'string' && caught.code.startsWith('MOBILE_')
          ? authErrorCopy(caught, pending.phase)
          : "The request could not be completed. Please try again or contact support.");
      }
    } finally {
      if (isCurrent(pending)) {
        logMobileAuthDebug('operation.end', { operation: pending, step: stepRef.current });
        operation.current = null;
        setIsLoading(false);
      }
    }
  };

  const sendOtp = async (auth, activeFlow, pending) => {
    // An unconfirmed send may have delivered a code; only manual Resend can
    // repeat it within the same flow, including when entering recovery.
    otpAttempted.current = true;
    const sent = await auth.sendOtp({ mobileNumber: activeFlow.mobileNumber });
    logMobileAuthDebug('otp.send.result', { mobileNumber: activeFlow.mobileNumber, current: isCurrent(pending), sent });
    if (!isCurrent(pending)) return;
    const cooldown = Math.min(RESEND_SECONDS, sent.expiresIn);
    setOtpSent(true);
    setResendDeadline(Date.now() + cooldown * 1000);
    setResendSeconds(cooldown);
  };

  const applyFlow = async (auth, activeFlow, pending) => {
    if (!isCurrent(pending)) return;
    // The SDK's resolved flow (step, fields, policy snapshot); it holds no credentials.
    logMobileAuthDebug('flow', activeFlow, 'auth-sdk');
    clearSecrets();
    setPasswordMode(null);
    setFlow(activeFlow);
    otpAttempted.current = false;
    setOtpSent(false);
    setResendDeadline(0);
    setResendSeconds(0);
    const next = initialMobileAuthStep(activeFlow);
    moveTo(next);
    // Both-factor sign-in asks for the password first. Navigation itself never
    // sends; only entry to a new OTP transaction or explicit Resend does.
    if (next === STEPS.OTP && activeFlow.credentials.otp.requirement === 'required') {
      await sendOtp(auth, activeFlow, pending);
    }
  };

  const begin = async () => {
    if (operation.current || stepRef.current !== STEPS.MOBILE) return;
    setCompanyCodeError('');
    setServerAddressError('');
    setMobileNumberError('');
    const mobile = mobileNumber.trim();
    if (!mobile) {
      setMobileNumberError("Enter your mobile number.");
      return;
    }
    const code = normalizeCompanyCode(companyCode);
    const manual = !backendUrl && discovery === 'server';
    let manualUrl = '';
    if (manual) {
      const address = normalizeBackendUrl(serverAddress);
      // The SDK only accepts HTTPS origins; say so at the field instead of failing later.
      const issue = validateBackendUrl(address) || (/^http:/i.test(address) ? 'insecure' : null);
      if (issue) {
        setServerAddressError(serverAddressIssueCopy(issue));
        return;
      }
      // A pasted desk link (/app/...) still names the site; Frappe serves from the origin.
      manualUrl = new URL(address).origin;
    } else if (!backendUrl) {
      const issue = validateCompanyCode(code);
      if (issue) {
        setCompanyCodeError(issue === 'required'
          ? "Enter your company code."
          : "That company code is too long. Check it and try again.");
        return;
      }
    }
    return run('begin', async pending => {
      // Returning to the unchanged account keeps the OTP transaction/cooldown.
      // Editing company/mobile discards flow, so a different account begins anew.
      if (flow && flow.mobileNumber === mobile && backendUrl) {
        const next = initialMobileAuthStep(flow);
        moveTo(next);
        if (next === STEPS.OTP && !otpAttempted.current) {
          await sendOtp(getMobileAuthClient(backendUrl), flow, pending);
        }
        return;
      }
      let resolvedUrl = backendUrl || manualUrl;
      if (!resolvedUrl) {
        pending.phase = 'lookup';
        const resolved = await lookupServer(code, {
          config: {
            url: process.env.EXPO_PUBLIC_SERVER_LOOKUP_URL,
            secret: process.env.EXPO_PUBLIC_SERVER_LOOKUP_SECRET,
            alphabet: process.env.EXPO_PUBLIC_SERVER_LOOKUP_ALPHABET,
          },
          onDebug: __DEV__
            ? (event, data) => console.log(`[lookup] ${event}`, data)
            : undefined,
        });
        if (!isCurrent(pending)) return;
        resolvedUrl = resolved.backendUrl;
      }
      pending.phase = manual ? 'manual' : 'begin';
      const auth = getMobileAuthClient(resolvedUrl);
      const activeFlow = await auth.begin({ mobileNumber: mobile });
      if (!isCurrent(pending)) return;
      pending.phase = 'begin';
      await writePreference(() => isCurrent(pending)
        ? AsyncStorage.setItem('backendUrl', resolvedUrl)
        : undefined);
      if (!isCurrent(pending)) return;
      setBackendUrl(resolvedUrl);
      setCompanyCodeState('');
      setServerAddressState('');
      setMobileNumberState(activeFlow.mobileNumber);
      await applyFlow(auth, activeFlow, pending);
    });
  };

  const validateOtp = () => {
    if (otp.trim()) return true;
    const message = "Enter the OTP.";
    setOtpError(message);
    setError(message);
    return false;
  };

  const validateNewPassword = () => {
    const issue = newPasswordError(newPassword, confirmPassword);
    setNewPasswordFieldError(newPassword.trim() && newPassword.length >= MIN_PASSWORD_LENGTH ? '' : issue);
    setConfirmPasswordError(newPassword.trim() && newPassword.length >= MIN_PASSWORD_LENGTH ? issue : '');
    if (issue) setError(issue);
    return !issue;
  };

  const complete = async ({ skipPassword = false } = {}) => {
    if (!flow || passwordMode || operation.current || stepRef.current === STEPS.COMPLETE) return;
    const credentials = {};
    const chosenPassword = flow.credentials.password.purpose === 'create' ? newPassword : password;
    for (const [name, value] of [['password', skipPassword ? '' : chosenPassword], ['otp', otp]]) {
      const requirement = flow.credentials[name].requirement;
      if (requirement === 'required' && !value.trim()) {
        const message = name === 'password'
          ? "Enter your password."
          : "Enter the OTP.";
        setError(message);
        if (name === 'otp') { setOtpError(message); moveTo(STEPS.OTP); }
        else setPasswordError(message);
        return;
      }
      if (requirement !== 'disabled' && value.trim()) credentials[name] = value;
    }
    // An untouched optional password stays omitted so the SDK can manage one.
    if (flow.credentials.password.purpose === 'create' && !skipPassword && !validateNewPassword()) return;
    return run('complete', async pending => {
      const auth = getMobileAuthClient(backendUrl);
      const result = await completeMobileSignIn({
        auth,
        flow,
        credentials,
        baseUrl: backendUrl,
        dispatch,
        isCancelled: () => !isCurrent(pending),
      });
      if (isCurrent(pending)) {
        clearFlow();
        moveTo(STEPS.COMPLETE);
      }
      return result;
    });
  };

  const resendOtp = () => {
    if (!flow || operation.current || stepRef.current !== STEPS.OTP || resendSeconds > 0 || (!passwordMode && flow.credentials.otp.requirement !== 'required')) return;
    setOtp('');
    setOtpError('');
    return run('otp', pending => sendOtp(getMobileAuthClient(backendUrl), flow, pending));
  };

  const startPasswordMode = mode => {
    if (!flow || operation.current || !(mode === 'create' ? canCreatePassword : canResetPassword)) return;
    clearSecrets();
    setError('');
    setPasswordMode(mode);
    moveTo(STEPS.OTP);
    if (!otpAttempted.current) {
      return run('otp', pending => sendOtp(getMobileAuthClient(backendUrl), flow, pending));
    }
  };

  const savePassword = () => {
    if (!flow || !passwordMode || operation.current) return;
    if (!otp.trim() || !newPassword.trim()) {
      setError("Enter the OTP and your new password.");
      return;
    }
    const issue = newPasswordError(newPassword, confirmPassword);
    if (issue) {
      setError(issue);
      return;
    }
    return run('password', async pending => {
      const auth = getMobileAuthClient(backendUrl);
      let unconfirmed = false;
      try {
        await auth.setPasswordWithOtp({ mobileNumber: flow.mobileNumber, otp, newPassword });
      } catch (caught) {
        logMobileAuthDebug('password.change.failed', { error: caught, unconfirmed: passwordChangeUnconfirmed(caught) });
        // The flow is a policy snapshot: if the change may have landed, it is stale.
        if (!passwordChangeUnconfirmed(caught)) throw caught;
        unconfirmed = true;
      }
      if (!isCurrent(pending)) return;
      pending.phase = 'begin';
      clearFlow();
      const activeFlow = await auth.begin({ mobileNumber: flow.mobileNumber });
      await applyFlow(auth, activeFlow, pending);
      if (unconfirmed && isCurrent(pending)) {
        setError("We couldn't confirm whether your password changed. Continue with the sign-in below.");
      }
    });
  };

  const changeCompany = async () => {
    cancelCurrent();
    clearFlow();
    setBackendUrl('');
    setCompanyCodeState('');
    setServerAddressState('');
    setMobileNumberState('');
    setError('');
    setCompanyCodeError('');
    setServerAddressError('');
    setMobileNumberError('');
    return run('changeCompany', async pending => {
      await writePreference(() => AsyncStorage.removeItem('backendUrl'));
      if (!isCurrent(pending)) return;
    });
  };

  const setMobileNumber = value => {
    cancelCurrent();
    clearFlow();
    setError('');
    setMobileNumberError('');
    setMobileNumberState(value);
  };

  const continuePasswordSignIn = () => {
    if (!flow || stepRef.current !== STEPS.PASSWORD_SIGN_IN || operation.current) return;
    if (!password.trim()) {
      const message = "Enter your password.";
      setPasswordError(message);
      setError(message);
      return;
    }
    setPasswordError('');
    setError('');
    if (flow.credentials.otp.requirement !== 'required') return complete();
    moveTo(STEPS.OTP);
    if (!otpAttempted.current) {
      return run('otp', pending => sendOtp(getMobileAuthClient(backendUrl), flow, pending));
    }
  };

  const submitOtp = () => {
    if (!flow || stepRef.current !== STEPS.OTP || operation.current || !validateOtp()) return;
    setOtpError('');
    setError('');
    // No SDK verifyOtp exists: retain this code only in memory until the final
    // signup/password-change API consumes it. Never label it server-verified.
    if (passwordMode || (flow.action === 'SIGN_UP' && flow.credentials.password.purpose === 'create')) {
      moveTo(passwordMode ? STEPS.PASSWORD_CREATE : signupPasswordStep(flow));
      return;
    }
    return complete();
  };

  const submitNewPassword = () => {
    if (![STEPS.PASSWORD_CREATE, STEPS.PASSWORD_OPTION].includes(stepRef.current) || operation.current || !validateNewPassword()) return;
    return passwordMode ? savePassword() : complete();
  };

  const skipPassword = () => {
    if (stepRef.current !== STEPS.PASSWORD_OPTION || flow?.action !== 'SIGN_UP' || flow.credentials.password.requirement !== 'optional' || operation.current) return;
    return complete({ skipPassword: true });
  };

  const goBack = () => {
    if (operation.current || !flow) return;
    setError('');
    clearFieldErrors();
    if ([STEPS.PASSWORD_CREATE, STEPS.PASSWORD_OPTION].includes(stepRef.current)) {
      moveTo(STEPS.OTP);
    } else if (stepRef.current === STEPS.OTP && passwordMode) {
      clearSecrets();
      setPasswordMode(null);
      moveTo(initialMobileAuthStep(flow));
    } else if (stepRef.current === STEPS.OTP && initialMobileAuthStep(flow) === STEPS.PASSWORD_SIGN_IN) {
      setOtp('');
      moveTo(STEPS.PASSWORD_SIGN_IN);
    } else {
      clearSecrets();
      setPasswordMode(null);
      moveTo(STEPS.MOBILE);
    }
  };

  const cancelFlow = () => {
    cancelCurrent();
    clearFlow();
    setError('');
  };

  return {
    backendUrl,
    companyCode,
    setCompanyCode: value => {
      cancelCurrent();
      clearFlow();
      setCompanyCodeError('');
      setError('');
      setCompanyCodeState(value);
    },
    discovery,
    setDiscovery: mode => {
      cancelCurrent();
      clearFlow();
      setError('');
      setCompanyCodeError('');
      setServerAddressError('');
      setDiscoveryState(mode);
    },
    serverAddress,
    setServerAddress: value => {
      cancelCurrent();
      clearFlow();
      setServerAddressError('');
      setError('');
      setServerAddressState(value);
    },
    serverAddressError: t(serverAddressError),
    mobileNumber,
    setMobileNumber,
    password,
    setPassword: value => { setPassword(value); setPasswordError(''); setError(''); },
    otp,
    // Codes are digits; drop whitespace a paste can bring (passwords stay untouched).
    setOtp: value => { setOtp(value.replace(/\s/g, '')); setOtpError(''); setError(''); },
    newPassword,
    setNewPassword: value => { setNewPassword(value); setNewPasswordFieldError(''); setConfirmPasswordError(''); setError(''); },
    confirmPassword,
    setConfirmPassword: value => { setConfirmPassword(value); setConfirmPasswordError(''); setError(''); },
    flow,
    step,
    passwordMode,
    canCreatePassword,
    canResetPassword,
    isLoading,
    isHydrating,
    isAvailable: isMobileAuthAvailable(),
    error: t(error),
    companyCodeError: t(companyCodeError),
    mobileNumberError: t(mobileNumberError),
    passwordError: t(passwordError),
    newPasswordError: t(newPasswordFieldError || (newPassword && (!newPassword.trim() || newPassword.length < MIN_PASSWORD_LENGTH)
      ? newPasswordError(newPassword, confirmPassword) : '')),
    confirmPasswordError: t(confirmPasswordError || (confirmPassword && newPassword !== confirmPassword
      ? "Passwords do not match." : '')),
    otpError: t(otpError),
    isNewPasswordValid: !!newPassword.trim() && newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword,
    resendSeconds,
    otpSent,
    begin,
    resendOtp,
    changeCompany,
    continuePasswordSignIn,
    submitOtp,
    submitNewPassword,
    skipPassword,
    goBack,
    cancelFlow,
    startCreatePassword: () => startPasswordMode('create'),
    startResetPassword: () => startPasswordMode('reset'),
  };
}

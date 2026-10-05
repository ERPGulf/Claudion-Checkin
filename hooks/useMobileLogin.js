import { useEffect, useRef, useState } from 'react';
import { I18nManager } from 'react-native';
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

const copy = (english, arabic) => I18nManager.isRTL ? arabic : english;

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
  if (!value.trim()) return copy("Password can't be only spaces.", 'لا يمكن أن تتكوّن كلمة المرور من مسافات فقط.');
  if (value.length < MIN_PASSWORD_LENGTH) return copy('Password must be at least 8 characters.', 'يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل.');
  if (value !== confirmation) return copy('Passwords do not match.', 'كلمتا المرور غير متطابقتين.');
  return '';
}

function lookupErrorCopy(error) {
  if (error instanceof ServerLookupConfigurationError) {
    return copy('Setup is not configured correctly in this app. Please contact support.', 'خدمة الإعداد غير مهيّأة بشكل صحيح في هذا التطبيق. يُرجى التواصل مع الدعم.');
  }
  if (!(error instanceof ServerLookupError)) return null;
  switch (error.kind) {
    case 'notFound':
      return copy("We couldn't find that company code. Check the code and try again.", 'لم نتمكّن من العثور على رمز الشركة. تحقّق من الرمز وحاول مرة أخرى.');
    case 'unavailable':
      return copy("We couldn't connect to the setup service. Check your internet connection and try again.", 'تعذّر الاتصال بخدمة الإعداد. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.');
    default:
      return copy('The setup service returned an invalid response. Please try again or contact support.', 'أعادت خدمة الإعداد استجابة غير صالحة. حاول مرة أخرى أو تواصل مع الدعم.');
  }
}

// A typed address fails in ways a looked-up one does not: a typo'd host is a
// network error, and a reachable non-Frappe host answers 404.
const MANUAL_SERVER_FAILURES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'INVALID_RESPONSE', 'INVALID_BASE_URL', 'MASTER_TOKEN_FAILED', 'MASTER_TOKEN_REJECTED']);

function serverAddressIssueCopy(issue) {
  switch (issue) {
    case 'required':
      return copy('Enter the server address.', 'أدخل عنوان الخادم.');
    case 'insecure':
      return copy('The server address must use https.', 'يجب أن يستخدم عنوان الخادم بروتوكول https.');
    default:
      return copy("That address doesn't look right. Check it and try again.", 'لا يبدو هذا العنوان صحيحًا. تحقّق منه وحاول مرة أخرى.');
  }
}

function authErrorCopy(error, phase) {
  if (phase === 'password' && error.code === 'INVALID_PASSWORD') {
    return copy("That password can't be used. Try a different one.", 'لا يمكن استخدام كلمة المرور هذه. جرّب كلمة مرور أخرى.');
  }
  if (phase === 'password' && error.code === 'AUTHENTICATION_FAILED') {
    return copy("We couldn't change your password. Check the code and try again.", 'تعذّر تغيير كلمة المرور. تحقّق من الرمز وحاول مرة أخرى.');
  }
  switch (error.code) {
    case 'INVALID_BASE_URL':
      return copy('The setup service returned an invalid response. Please try again or contact support.', 'أعادت خدمة الإعداد استجابة غير صالحة. حاول مرة أخرى أو تواصل مع الدعم.');
    case 'INVALID_OR_EXPIRED_OTP':
      return copy('The OTP is invalid or expired. Check it or request a new code.', 'رمز التحقق غير صحيح أو منتهي الصلاحية. تحقّق منه أو اطلب رمزًا جديدًا.');
    case 'INVALID_PASSWORD':
      return copy('The password is incorrect. Please try again.', 'كلمة المرور غير صحيحة. يُرجى المحاولة مرة أخرى.');
    case 'INVALID_MOBILE':
      return copy('Enter your mobile number.', 'أدخل رقم هاتفك المحمول.');
    case 'UNSUPPORTED_POLICY':
    case 'INVALID_RESPONSE':
      return copy('Sign-in is not available for this account. Please contact support.', 'تسجيل الدخول غير متاح لهذا الحساب. يُرجى التواصل مع الدعم.');
    case 'INVALID_CLIENT_CONFIG':
      return copy('Mobile sign-in is unavailable in this app build. Please update the app.', 'تسجيل الدخول برقم الهاتف غير متاح في هذا الإصدار. يُرجى تحديث التطبيق.');
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return error.retryable
        ? copy('The server could not be reached. Check your connection and try again.', 'تعذّر الوصول إلى الخادم. تحقّق من اتصالك وحاول مرة أخرى.')
        : copy('The request could not be confirmed. Check before submitting again; an OTP may already have been used.', 'تعذّر تأكيد الطلب. تحقّق قبل الإرسال مجددًا؛ ربما تم استخدام رمز التحقق.');
    // The SDK's own service credential failed; nothing the employee entered.
    case 'MASTER_TOKEN_FAILED':
    case 'MASTER_TOKEN_REJECTED':
      return copy('The sign-in service is unavailable right now. Please try again shortly.', 'خدمة تسجيل الدخول غير متاحة حاليًا. يُرجى المحاولة مرة أخرى بعد قليل.');
    default:
      return copy('Sign-in was not successful. Check your details or contact support.', 'لم ينجح تسجيل الدخول. تحقّق من بياناتك أو تواصل مع الدعم.');
  }
}

/** Company discovery and SDK forms remain separate from the established QR login. */
export default function useMobileLogin() {
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
  const [passwordMode, setPasswordMode] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState('');
  const [companyCodeError, setCompanyCodeError] = useState('');
  const [serverAddressError, setServerAddressError] = useState('');
  const [mobileNumberError, setMobileNumberError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendDeadline, setResendDeadline] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(null);
  const otpAttempted = useRef(false);
  const sequence = useRef(0);
  const preferenceWrites = useRef(Promise.resolve());

  const isCurrent = pending => mounted.current && operation.current === pending;
  const clearSecrets = () => {
    setPassword('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
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
  };
  const cancelCurrent = () => {
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
    if (operation.current || isHydrating || !isMobileAuthAvailable()) return;
    const pending = { id: ++sequence.current, kind, phase: kind };
    operation.current = pending;
    setIsLoading(true);
    setError('');
    try {
      return await task(pending);
    } catch (caught) {
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
        if (caught.code === 'INVALID_OR_EXPIRED_OTP') setOtp('');
        if (caught.code === 'INVALID_PASSWORD') {
          setPassword('');
          setNewPassword('');
          setConfirmPassword('');
        }
        setError(pending.phase === 'manual' && MANUAL_SERVER_FAILURES.has(caught.code)
          ? copy("We couldn't connect to that server. Check the address and try again.", 'تعذّر الاتصال بهذا الخادم. تحقّق من العنوان وحاول مرة أخرى.')
          : authErrorCopy(caught, pending.phase));
      } else {
        setError(copy('The request could not be completed. Please try again or contact support.', 'تعذّر إكمال الطلب. يُرجى المحاولة مرة أخرى أو التواصل مع الدعم.'));
      }
    } finally {
      if (isCurrent(pending)) {
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
    if (!isCurrent(pending)) return;
    const cooldown = Math.min(RESEND_SECONDS, sent.expiresIn);
    setOtpSent(true);
    setResendDeadline(Date.now() + cooldown * 1000);
    setResendSeconds(cooldown);
  };

  const applyFlow = async (auth, activeFlow, pending) => {
    if (!isCurrent(pending)) return;
    // The SDK's resolved flow (step, fields, policy snapshot); it holds no credentials.
    if (__DEV__) console.log('[auth-sdk] flow', JSON.stringify(activeFlow));
    clearSecrets();
    setPasswordMode(null);
    setFlow(activeFlow);
    otpAttempted.current = false;
    setOtpSent(false);
    setResendDeadline(0);
    setResendSeconds(0);
    if (activeFlow.credentials.otp.requirement === 'required') {
      await sendOtp(auth, activeFlow, pending);
    }
  };

  const begin = async () => {
    setCompanyCodeError('');
    setServerAddressError('');
    setMobileNumberError('');
    const mobile = mobileNumber.trim();
    if (!mobile) {
      setMobileNumberError(copy('Enter your mobile number.', 'أدخل رقم هاتفك المحمول.'));
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
          ? copy('Enter your company code.', 'أدخل رمز الشركة.')
          : copy('That company code is too long. Check it and try again.', 'رمز الشركة طويل جدًا. تحقّق منه وحاول مرة أخرى.'));
        return;
      }
    }
    return run('begin', async pending => {
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

  const complete = async () => {
    if (!flow || passwordMode) return;
    const credentials = {};
    for (const [name, value] of [['password', password], ['otp', otp]]) {
      const requirement = flow.credentials[name].requirement;
      if (requirement === 'required' && !value.trim()) {
        setError(name === 'password'
          ? copy('Enter your password.', 'أدخل كلمة المرور.')
          : copy('Enter the OTP.', 'أدخل رمز التحقق.'));
        return;
      }
      if (requirement !== 'disabled' && value.trim()) credentials[name] = value;
    }
    // An untouched optional password stays omitted so the SDK can manage one.
    if (flow.credentials.password.purpose === 'create' && password) {
      const issue = newPasswordError(password, confirmPassword);
      if (issue) {
        setError(issue);
        return;
      }
    }
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
      if (isCurrent(pending)) clearSecrets();
      return result;
    });
  };

  const resendOtp = () => {
    if (!flow || resendSeconds > 0 || (!passwordMode && flow.credentials.otp.requirement !== 'required')) return;
    return run('otp', pending => sendOtp(getMobileAuthClient(backendUrl), flow, pending));
  };

  const startPasswordMode = mode => {
    if (!flow || operation.current || !(mode === 'create' ? canCreatePassword : canResetPassword)) return;
    clearSecrets();
    setError('');
    setPasswordMode(mode);
    if (!otpAttempted.current) {
      return run('otp', pending => sendOtp(getMobileAuthClient(backendUrl), flow, pending));
    }
  };

  const savePassword = () => {
    if (!flow || !passwordMode) return;
    if (!otp.trim() || !newPassword.trim()) {
      setError(copy('Enter the OTP and your new password.', 'أدخل رمز التحقق وكلمة المرور الجديدة.'));
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
        setError(copy("We couldn't confirm whether your password changed. Continue with the sign-in below.", 'تعذّر التأكد من تغيير كلمة المرور. تابع تسجيل الدخول أدناه.'));
      }
    });
  };

  const changeCompany = async () => {
    cancelCurrent();
    clearFlow();
    setBackendUrl('');
    setCompanyCodeState('');
    setServerAddressState('');
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

  return {
    backendUrl,
    companyCode,
    setCompanyCode: value => {
      cancelCurrent();
      setCompanyCodeError('');
      setError('');
      setCompanyCodeState(value);
    },
    discovery,
    setDiscovery: mode => {
      cancelCurrent();
      setError('');
      setCompanyCodeError('');
      setServerAddressError('');
      setDiscoveryState(mode);
    },
    serverAddress,
    setServerAddress: value => {
      cancelCurrent();
      setServerAddressError('');
      setError('');
      setServerAddressState(value);
    },
    serverAddressError,
    mobileNumber,
    setMobileNumber,
    password,
    setPassword,
    otp,
    // Codes are digits; drop whitespace a paste can bring (passwords stay untouched).
    setOtp: value => setOtp(value.replace(/\s/g, '')),
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    flow,
    passwordMode,
    canCreatePassword,
    canResetPassword,
    isLoading,
    isHydrating,
    isAvailable: isMobileAuthAvailable(),
    error,
    companyCodeError,
    mobileNumberError,
    resendSeconds,
    otpSent,
    begin,
    complete,
    resendOtp,
    changeCompany,
    startCreatePassword: () => startPasswordMode('create'),
    startResetPassword: () => startPasswordMode('reset'),
    cancelPasswordMode: () => {
      if (operation.current) return;
      clearSecrets();
      setPasswordMode(null);
      setError('');
    },
    savePassword,
  };
}

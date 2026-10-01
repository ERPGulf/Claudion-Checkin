import { useEffect, useRef, useState } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import { isAuthError } from '@erpgulf/auth-sdk';
import {
  lookupServer,
  normalizeCompanyCode,
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

function authErrorCopy(error) {
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
    default:
      return copy('Sign-in was not successful. Check your details or contact support.', 'لم ينجح تسجيل الدخول. تحقّق من بياناتك أو تواصل مع الدعم.');
  }
}

/** Company discovery and SDK forms remain separate from the established QR login. */
export default function useMobileLogin() {
  const dispatch = useDispatch();
  const [backendUrl, setBackendUrl] = useState('');
  const [companyCode, setCompanyCodeState] = useState('');
  const [mobileNumber, setMobileNumberState] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [flow, setFlow] = useState(null);
  const [passwordMode, setPasswordMode] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState('');
  const [companyCodeError, setCompanyCodeError] = useState('');
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
  };
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
        setError(authErrorCopy(caught));
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
    setOtpSent(true);
    setResendDeadline(Date.now() + sent.expiresIn * 1000);
    setResendSeconds(sent.expiresIn);
  };

  const applyFlow = async (auth, activeFlow, pending) => {
    if (!isCurrent(pending)) return;
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
    setMobileNumberError('');
    const mobile = mobileNumber.trim();
    if (!mobile) {
      setMobileNumberError(copy('Enter your mobile number.', 'أدخل رقم هاتفك المحمول.'));
      return;
    }
    const code = normalizeCompanyCode(companyCode);
    if (!backendUrl) {
      const issue = validateCompanyCode(code);
      if (issue) {
        setCompanyCodeError(issue === 'required'
          ? copy('Enter your company code.', 'أدخل رمز الشركة.')
          : copy('That company code is too long. Check it and try again.', 'رمز الشركة طويل جدًا. تحقّق منه وحاول مرة أخرى.'));
        return;
      }
    }
    return run('begin', async pending => {
      let resolvedUrl = backendUrl;
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
      pending.phase = 'begin';
      const auth = getMobileAuthClient(resolvedUrl);
      const activeFlow = await auth.begin({ mobileNumber: mobile });
      if (!isCurrent(pending)) return;
      await writePreference(() => isCurrent(pending)
        ? AsyncStorage.setItem('backendUrl', resolvedUrl)
        : undefined);
      if (!isCurrent(pending)) return;
      setBackendUrl(resolvedUrl);
      setCompanyCodeState('');
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
    if (!flow || operation.current || !(mode === 'create' ? flow.capabilities.canCreatePassword : flow.capabilities.canResetPassword)) return;
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
    return run('password', async pending => {
      const auth = getMobileAuthClient(backendUrl);
      await auth.setPasswordWithOtp({ mobileNumber: flow.mobileNumber, otp, newPassword });
      if (!isCurrent(pending)) return;
      clearFlow();
      const activeFlow = await auth.begin({ mobileNumber: flow.mobileNumber });
      await applyFlow(auth, activeFlow, pending);
    });
  };

  const changeCompany = async () => {
    cancelCurrent();
    clearFlow();
    setBackendUrl('');
    setCompanyCodeState('');
    setError('');
    setCompanyCodeError('');
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
    mobileNumber,
    setMobileNumber,
    password,
    setPassword,
    otp,
    setOtp,
    newPassword,
    setNewPassword,
    flow,
    passwordMode,
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

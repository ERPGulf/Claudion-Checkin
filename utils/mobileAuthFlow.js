// UI steps subdivide the SDK's resolved form; the original SDK flow is always
// passed to complete() unchanged. Credentials never enter navigation params.
export const MOBILE_AUTH_STEPS = {
  MOBILE: 'MOBILE',
  OTP: 'OTP',
  PASSWORD_SIGN_IN: 'PASSWORD_SIGN_IN',
  PASSWORD_CREATE: 'PASSWORD_CREATE',
  PASSWORD_OPTION: 'PASSWORD_OPTION',
  COMPLETE: 'COMPLETE',
};

export const initialMobileAuthStep = flow => {
  if (flow.credentials.password.purpose === 'existing' && flow.credentials.password.requirement === 'required') {
    return MOBILE_AUTH_STEPS.PASSWORD_SIGN_IN;
  }
  return MOBILE_AUTH_STEPS.OTP;
};

export const signupPasswordStep = flow => flow.credentials.password.requirement === 'optional'
  ? MOBILE_AUTH_STEPS.PASSWORD_OPTION
  : MOBILE_AUTH_STEPS.PASSWORD_CREATE;

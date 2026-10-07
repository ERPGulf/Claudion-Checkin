import { logMobileAuthDebug } from '../utils/mobileAuthDebug';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('retains identity matching and request metadata while omitting every credential representation', () => {
  const secrets = ['synthetic-access', 'synthetic-refresh', 'synthetic-master', 'synthetic-password', 'synthetic-managed', '987654'];
  logMobileAuthDebug('employee.identity.verified', {
    matchedBy: 'canonical-document-id', sdkEmployeeId: 'HR-EMP-FAKE', employeeDocname: 'HR-EMP-FAKE',
    stage: 'employee.identity', status: 200, elapsedMs: 25,
    nested: { access_token: secrets[0], refreshToken: secrets[1], master_token: secrets[2],
      password: secrets[3], managed_password: secrets[4], otp: secrets[5] },
    credentials: { arbitrary: secrets[3] }, previousCredentials: { arbitrary: secrets[5] },
    headers: { Authorization: `Bearer ${secrets[2]}` },
    body: `password=${secrets[3]}&otp=${secrets[5]}`,
    rawBody: JSON.stringify({ token: secrets[0] }), form: { arbitrary: secrets[4] },
    values: { api_key: secrets[0], app_key: secrets[2] },
  });
  const logged = JSON.stringify(console.log.mock.calls);
  secrets.forEach(secret => expect(logged).not.toContain(secret));
  expect(JSON.parse(console.log.mock.calls[0][1])).toMatchObject({
    matchedBy: 'canonical-document-id', sdkEmployeeId: 'HR-EMP-FAKE', employeeDocname: 'HR-EMP-FAKE',
    stage: 'employee.identity', status: 200, elapsedMs: 25,
  });
});

it('omits native and Axios-style error text, stacks and encoded request data', () => {
  const secret = 'synthetic-native-secret';
  const nativeError = Object.assign(new Error(`Bearer ${secret}`), { code: 'NETWORK_ERROR', password: secret });
  const axiosError = {
    toJSON: () => ({ name: 'AxiosError', code: 'ECONNABORTED', message: secret, stack: secret,
      config: { data: `password=${secret}`, headers: { Authorization: secret } } }),
  };
  logMobileAuthDebug('employee.failed', { error: nativeError, status: 403 });
  logMobileAuthDebug('employee.failed', { error: axiosError, status: 500 });
  expect(JSON.stringify(console.log.mock.calls)).not.toContain(secret);
  expect(JSON.parse(console.log.mock.calls[0][1])).toMatchObject({ error: { name: 'Error', code: 'NETWORK_ERROR' }, status: 403 });
  expect(JSON.parse(console.log.mock.calls[1][1])).toMatchObject({ error: { name: 'AxiosError', code: 'ECONNABORTED' }, status: 500 });
});

it('does not affect authentication when a native error is circular or console throws', () => {
  const error = new Error('synthetic detail');
  error.cause = error;
  expect(() => logMobileAuthDebug('handoff.failed', { error })).not.toThrow();
  console.log.mockImplementation(() => { throw new Error('synthetic console failure'); });
  expect(() => logMobileAuthDebug('handoff.failed', { error })).not.toThrow();
});

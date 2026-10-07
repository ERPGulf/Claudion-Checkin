import { TextEncoder as NodeTextEncoder } from 'util';
import { TextDecoder as ExpoTextDecoder } from 'expo/src/winter/TextDecoder';
import {
  lookupServer,
  normalizeCompanyCode,
  validateCompanyCode,
  ServerLookupError,
  ServerLookupConfigurationError,
} from '@erpgulf/server-lookup';
import { lookupConfig, lookupResponse, sealFixture } from '../test-utils/serverLookupFixtures';

const originalFetch = global.fetch;
const originalEncoder = global.TextEncoder;
const originalDecoder = global.TextDecoder;
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
});

beforeAll(() => {
  global.TextEncoder = NodeTextEncoder;
  // Exercise the exact decoder installed by this app's Expo runtime.
  global.TextDecoder = ExpoTextDecoder;
});

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(response(lookupResponse()));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
  global.TextEncoder = originalEncoder;
  global.TextDecoder = originalDecoder;
});

it('decodes a synthetic sealed response under Expo TextDecoder and sends one anonymous encoded GET', async () => {
  const code = normalizeCompanyCode('  ABC +/أ  ');
  expect(validateCompanyCode(code)).toBeNull();
  await expect(lookupServer(code, { config: lookupConfig })).resolves.toEqual({ backendUrl: 'https://company.example.test' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    `https://lookup.example.test/api/method/get_mobile_server_url?company_code=${encodeURIComponent(code)}`,
    expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit' }),
  );
});

it('validates missing config lazily before a request or timer', async () => {
  const timer = jest.spyOn(global, 'setTimeout');
  await expect(lookupServer('ABC', { config: {} })).rejects.toBeInstanceOf(ServerLookupConfigurationError);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
});

it.each([
  [{ message: { success: false, error: 'untrusted server copy' } }, 200, 'notFound'],
  [{ message: { success: true, resp: 'malformed' } }, 200, 'invalidResponse'],
  [{ message: { success: true, resp: sealFixture('https://company.example.test', { corruptChecksum: true }) } }, 200, 'invalidResponse'],
  [{ message: { success: true, resp: sealFixture([0xc0, 0xaf]) } }, 200, 'invalidResponse'],
  [{ message: { success: false } }, 503, 'unavailable'],
])('maps backend outcome to safe category %s/%s/%s', async (body, status, kind) => {
  global.fetch.mockResolvedValue(response(body, status));
  await expect(lookupServer('ABC', { config: lookupConfig })).rejects.toMatchObject({
    name: 'ServerLookupError', kind, message: `Server lookup failed: ${kind}`,
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('does not retry network failures', async () => {
  global.fetch.mockRejectedValue(new Error('network unavailable'));
  await expect(lookupServer('ABC', { config: lookupConfig })).rejects.toMatchObject({ kind: 'unavailable' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('aborts its one request at fifteen seconds and clears the timer', async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = lookupServer('ABC', { config: lookupConfig });
  const rejection = expect(pending).rejects.toBeInstanceOf(ServerLookupError);
  jest.advanceTimersByTime(14999);
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  await rejection;
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not provide config, token, or raw response to development debug events', async () => {
  const onDebug = jest.fn();
  const body = lookupResponse();
  global.fetch.mockResolvedValue(response(body));
  await lookupServer('ABC', { config: lookupConfig, onDebug });
  expect(onDebug.mock.calls.map(([event]) => event)).toEqual(['request', 'resolved']);
  const events = JSON.stringify(onDebug.mock.calls);
  expect(events).not.toContain(lookupConfig.secret);
  expect(events).not.toContain(lookupConfig.alphabet);
  expect(events).not.toContain(body.message.resp);
});

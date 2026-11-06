import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchUploadJson, UPLOAD_TIMEOUT_MS, UPLOAD_UNCONFIRMED_MESSAGE } from '../services/api/uploadTransport';
import { uploadLeaveAttachment } from '../services/api/leave.service';
import { uploadExpenseAttachment } from '../services/api/expense.service';
import { uploadComplaintAttachment } from '../services/api/complaint.service';
import { uploadAttendanceAttachment } from '../services/api/attendance.service';

jest.mock('../services/api/apiClient', () => ({ __esModule: true, default: {} }));
jest.mock('../services/api/authHelper', () => ({
  getAuthContext: async () => ({ baseUrl: 'https://uploads.example.test', token: 'synthetic-upload-token' }),
  buildHeaders: jest.fn(),
}));
jest.mock('../services/capabilityPolicy', () => ({ assertCapability: jest.fn(async () => ({})), assertCapabilityCurrent: jest.fn() }));

const originalFetch = global.fetch;
const file = { uri: 'file:///synthetic.pdf', name: 'synthetic.pdf', type: 'application/pdf' };
const body = { message: { name: 'SYNTHETIC-FILE' } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.multiSet([['baseUrl', 'https://uploads.example.test'], ['access_token', 'synthetic-upload-token']]);
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each(['headers', 'body'])('bounds a stalled %s even if the transport ignores abort, without another attempt', async stage => {
  const waiting = deferred();
  fetch.mockImplementation(() => stage === 'headers' ? waiting.promise
    : Promise.resolve({ ok: true, json: () => waiting.promise }));
  const operation = fetchUploadJson('https://uploads.example.test/upload', { method: 'POST' });
  const failure = operation.catch(error => error);
  await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
  expect(await failure).toMatchObject({ code: 'UPLOAD_CONFIRMATION_TIMEOUT', outcomeUnconfirmed: true });
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  waiting.reject(new Error('synthetic late transport failure'));
  await Promise.resolve();
});

it('clears its deadline after success and preserves the response/body', async () => {
  const response = { ok: true, status: 200, json: async () => body };
  fetch.mockResolvedValue(response);
  const payload = new FormData();
  expect(await fetchUploadJson('/upload', { method: 'POST', body: payload })).toEqual({ response, result: body });
  expect(fetch.mock.calls[0][1].body).toBe(payload);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('clears its deadline after a transport rejection without retrying', async () => {
  const error = new Error('synthetic transport failure');
  fetch.mockRejectedValue(error);
  await expect(fetchUploadJson('/upload', {})).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('preserves the caller-specific malformed JSON contract', async () => {
  fetch.mockResolvedValue({ json: async () => { throw new SyntaxError('synthetic malformed JSON'); } });
  await expect(fetchUploadJson('/upload', {}, { invalidJsonMessage: 'Invalid server response' }))
    .rejects.toThrow('Invalid server response');
  expect(jest.getTimerCount()).toBe(0);
});

const uploads = [
  ['leave', uploadLeaveAttachment, { message: body }],
  ['expense', uploadExpenseAttachment, { message: body }],
  ['complaint', uploadComplaintAttachment, body],
  ['attendance request', uploadAttendanceAttachment, { success: true, data: body }],
];

it.each(uploads)('preserves successful %s upload shape and uses a single multipart request', async (_name, upload, result) => {
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
  expect(await upload(file, 'SYNTHETIC-DOC')).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer synthetic-upload-token' } });
  expect(jest.getTimerCount()).toBe(0);
});

it.each(uploads)('settles a stalled %s upload while preserving its error-return/throw convention', async (_name, upload) => {
  fetch.mockImplementation(() => new Promise(() => {}));
  const operation = upload(file, 'SYNTHETIC-DOC').then(value => ({ value }), error => ({ error }));
  await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
  const outcome = await operation;
  expect(outcome.error?.message ?? outcome.value?.error).toBe(UPLOAD_UNCONFIRMED_MESSAGE);
  if (upload === uploadComplaintAttachment) expect(outcome.error.code).toBe('UPLOAD_CONFIRMATION_TIMEOUT');
  else expect(outcome.error).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

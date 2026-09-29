jest.mock('../services/api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

jest.mock('../services/api/authHelper', () => ({
  getAuthContext: jest.fn(),
  buildHeaders: (token, contentType) => ({
    Authorization: `Bearer ${token}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }),
}));

/* eslint-disable import/first */
import apiClient from '../services/api/apiClient';
import { getAuthContext } from '../services/api/authHelper';
import {
  submitResignation,
  RESIGNATION_METHOD,
  RESIGNATION_ERROR_MESSAGE,
} from '../services/api/resignation.service';
/* eslint-enable import/first */

const RECORD = {
  name: 16,
  employee: 'HR-EMP-00001',
  resignation_date: '2026-09-02 11:46:09',
  reason: 'test',
  file_url: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  getAuthContext.mockResolvedValue({
    baseUrl: 'https://tenant.example.com',
    token: 'synthetic-token',
    employeeCode: 'HR-EMP-00001',
  });
});

afterEach(() => {
  console.log.mockRestore();
});

describe('submitResignation', () => {
  it('posts form-data to the tenant and unwraps the record', async () => {
    apiClient.post.mockResolvedValue({ data: { message: RECORD } });

    const result = await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
    });

    expect(result).toEqual({ message: RECORD });

    const [url, body, config] = apiClient.post.mock.calls[0];
    expect(url).toBe(
      `https://tenant.example.com/api/method/${RESIGNATION_METHOD}`,
    );
    expect(body).toBeInstanceOf(FormData);
    expect(config.headers.Authorization).toBe('Bearer synthetic-token');
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
  });

  it('sends both attachments as file1 and file2 in the same request', async () => {
    apiClient.post.mockResolvedValue({ data: { message: RECORD } });
    const letter = { uri: 'file:///tmp/letter.pdf', name: 'letter.pdf', type: 'application/pdf' };
    const notice = { uri: 'file:///tmp/notice.png', name: 'notice.png', type: 'image/png' };

    await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
      file1: letter,
      file2: notice,
    });

    const body = apiClient.post.mock.calls[0][1];
    expect(body.get('resignation_date')).toBe('2026-09-02 11:46:09');
    expect(body.get('reason')).toBe('test');
    expect(body.has('file1')).toBe(true);
    expect(body.has('file2')).toBe(true);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('leaves out file fields that have no file', async () => {
    apiClient.post.mockResolvedValue({ data: { message: RECORD } });

    await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
      file1: null,
      file2: undefined,
    });

    const body = apiClient.post.mock.calls[0][1];
    expect(body.has('file1')).toBe(false);
    expect(body.has('file2')).toBe(false);
  });

  it('returns a plain error, never the server text, on failure', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 417, data: { message: 'frappe.exceptions.X' } },
    });

    const result = await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
    });

    expect(result).toEqual({ error: RESIGNATION_ERROR_MESSAGE });
  });

  it('treats a response without a record name as a failure', async () => {
    apiClient.post.mockResolvedValue({ data: { message: {} } });

    const result = await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
    });

    expect(result).toEqual({ error: RESIGNATION_ERROR_MESSAGE });
  });

  it('returns an error when the device has no session', async () => {
    getAuthContext.mockRejectedValue(new Error('Session expired'));

    const result = await submitResignation({
      resignationDate: '2026-09-02 11:46:09',
      reason: 'test',
    });

    expect(result).toEqual({ error: RESIGNATION_ERROR_MESSAGE });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

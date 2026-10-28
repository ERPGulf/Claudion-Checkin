import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api/apiClient';
import { getNotifications, markNotificationAsRead } from '../services/api/notification.service';
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

jest.mock('../services/api/apiClient', () => ({
  __esModule: true, default: { get: jest.fn(), put: jest.fn() },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', 'https://synthetic.example.test'], ['access_token', 'synthetic-token'],
  ]);
});

it('returns genuine empty success for both default and strict callers', async () => {
  apiClient.get.mockResolvedValue({ data: { message: [] } });
  await expect(getNotifications('EMP-SYNTHETIC')).resolves.toEqual([]);
  await expect(getNotifications('EMP-SYNTHETIC', { throwOnError: true })).resolves.toEqual([]);
});

it('preserves default failure compatibility while allowing the inbox to distinguish errors', async () => {
  const outage = new Error('synthetic transport failure');
  apiClient.get.mockRejectedValue(outage);
  await expect(getNotifications('EMP-SYNTHETIC')).resolves.toEqual([]);
  await expect(getNotifications('EMP-SYNTHETIC', { throwOnError: true })).rejects.toBe(outage);
});

it('does not mistake a malformed strict response for an empty inbox', async () => {
  apiClient.get.mockResolvedValue({ data: { message: { unexpected: true } } });
  await expect(getNotifications('EMP-SYNTHETIC')).resolves.toEqual([]);
  await expect(getNotifications('EMP-SYNTHETIC', { throwOnError: true })).rejects.toThrow('Invalid notification response.');
});

it('keeps normalization and endpoint parameters unchanged', async () => {
  apiClient.get.mockResolvedValue({ data: { message: [{ name: 'SYNTHETIC', read: '0', type: 'Leave' }] } });
  await expect(getNotifications('EMP-SYNTHETIC', { throwOnError: true })).resolves.toEqual([
    { name: 'SYNTHETIC', read: 0, type: 'leave' },
  ]);
  expect(apiClient.get).toHaveBeenCalledWith(
    'https://synthetic.example.test/api/method/employee_app.attendance_api.get_notification',
    expect.objectContaining({ params: { employee: 'EMP-SYNTHETIC' } }),
  );
});

it('does not publish a response from an invalidated session', async () => {
  let resolve;
  apiClient.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  const request = getNotifications('EMP-SYNTHETIC', { throwOnError: true });
  while (!resolve) await Promise.resolve();
  invalidateAuthSession();
  resolve({ data: { message: [{ name: 'OLD-NOTIFICATION', read: 0 }] } });
  await expect(request).rejects.toMatchObject({ code: 'NOTIFICATION_SESSION_CHANGED' });
});

it('does not send a mark-read mutation from a suspended session', async () => {
  invalidateAuthSession();
  await expect(markNotificationAsRead('SYNTHETIC')).rejects.toMatchObject({ code: 'NOTIFICATION_SESSION_CHANGED' });
  expect(apiClient.put).not.toHaveBeenCalled();
});

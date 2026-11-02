jest.mock('../modules/expo-auto-attendance', () => ({ isMonitoring: () => false }));
import { describeAutoAttendanceStatus, describeLocationVerification, describePresence } from '../utils/autoAttendance';

test('unknown OS access does not claim that the employee revoked permission', () => {
  expect(describeAutoAttendanceStatus({ configured: true, permitted: null, monitoring: 'permission',
    locationAccess: { state: 'unknown' } })).toMatchObject({ key: 'access_unknown', tone: 'neutral' });
});

test('recovery waits for accurate location without reporting an active session', () => {
  const locationAccess = { state: 'confirmed_available', recoveryPending: true };
  expect(describeAutoAttendanceStatus({ configured: true, permitted: true, monitoring: 'active', locationAccess }))
    .toMatchObject({ key: 'waiting_for_accurate_location' });
  expect(describeLocationVerification({ locationAccess, autoSessionActive: false }))
    .toMatchObject({ message: 'Waiting for an accurate location. We’ll retry automatically.' });
});

test.each([null, { verification: 'uncertain', withinRadius: false }])(
  'weak or unavailable GPS preserves only the known active AUTO-session notice (%p)', presence => {
    const observation = { presence, presenceObserved: true };
    expect(describeLocationVerification({ ...observation, autoSessionActive: true }))
      .toMatchObject({ message: 'Location signal is weak. Your check-in remains active.' });
    expect(describeLocationVerification({ ...observation, autoSessionActive: false })).toBeNull();
    expect(describeLocationVerification({ ...observation, autoSessionActive: true,
      locationAccess: { state: 'confirmed_disabled' } })).toBeNull();
  },
);

test('no preserved-session claim appears before observation or while an access-loss episode is pending', () => {
  expect(describeLocationVerification({ autoSessionActive: true, presence: null, presenceObserved: false })).toBeNull();
  expect(describeLocationVerification({ autoSessionActive: true, presence: null, presenceObserved: true,
    locationAccess: { state: 'unknown', recoveryPending: true } })).toBeNull();
});

test('uncertain coordinates do not label an employee as away from the office', () => {
  expect(describePresence({ verification: 'uncertain', withinRadius: false }, false))
    .toMatchObject({ tone: 'neutral', label: 'Waiting for accurate location' });
});

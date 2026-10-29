import React from 'react';
import { act, render } from '@testing-library/react-native';
import { setLanguage, t, translateMessage } from '../localization';
import { describeLogType, describeSyncStatus, SYNC_STATUS, mergeQueuedRecords, groupRecordsByDay } from '../utils/attendanceHistory';
import { describeOfflineStatus, describeQueueRow, OFFLINE_PHASE } from '../utils/offlineStatus';
import { describePolicy, describeLocationAccessSteps } from '../utils/autoAttendance';
import { GEOTAGGING } from '../redux/Slices/AutoAttendanceSlice';
import HistorySectionHeader from '../components/AttendanceHistory/HistorySectionHeader';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../hooks/useAppTheme', () => () => ({ colors: require('../constants').COLORS, isDark: false }));

beforeEach(async () => { await act(async () => { await setLanguage('en'); }); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

test('attendance wire data and merge ordering stay identical in both languages', async () => {
  const server = [{ name: 'CHECKIN-1', log_type: 'IN', time: '2026-10-29 09:00:00' }];
  const queue = [{ id: 2, action: 'checkout', timestamp: '2026-10-29 17:00:00', status: 'pending', payload: {} }];
  const snapshot = JSON.stringify({ server, queue });
  const english = mergeQueuedRecords(server, queue);
  await setLanguage('ar');
  const arabic = mergeQueuedRecords(server, queue);
  expect(arabic).toEqual(english);
  expect(JSON.stringify({ server, queue })).toBe(snapshot);
  expect(groupRecordsByDay(arabic)[0].title).toMatch(/[\u0600-\u06ff]/);
  expect(arabic[0].log_type).toBe('OUT');
  expect(describeLogType('OUT').label).toBe('تم تسجيل الانصراف');
  expect(describeSyncStatus(SYNC_STATUS.PENDING).label).toBe('بانتظار المزامنة');
});

test('Arabic distinguishes local queue acceptance, server sync and review without changing recovery flags', async () => {
  const row = { status: 'blocked', failureClass: 'endpoint-missing' };
  const before = describeQueueRow(row);
  await setLanguage('ar');
  const after = describeQueueRow(row);
  for (const flag of ['tone', 'willRetry', 'needsAdmin', 'needsEmployee', 'canCorrect']) expect(after[flag]).toBe(before[flag]);
  expect(after.reason).toMatch(/[\u0600-\u06ff]/);
  expect(describeOfflineStatus(OFFLINE_PHASE.WAITING, { pending: 2 }).subtitle).toContain('محفوظان');
  expect(describeOfflineStatus(OFFLINE_PHASE.NEEDS_CORRECTION, { rejected: 11 }).title).toContain('11');
  expect(t('No connection — your attendance was not marked. Please try again once you\'re online.')).toContain('لم يُسجّل');
});

test('all policy modes and permission steps localize while stable policy values remain unchanged', async () => {
  const modes = [GEOTAGGING.DISABLED, GEOTAGGING.WARNINGS_ONLY, GEOTAGGING.ALL_ACTIONS];
  const english = modes.map(describePolicy);
  await setLanguage('ar');
  const arabic = modes.map(describePolicy);
  expect(modes).toEqual([0, 1, 2]);
  expect(translateMessage('Precise Location was turned off; automatic check-in/out may be unreliable until it\'s turned back on for this app.')).toContain('الموقع الدقيق');
  arabic.forEach((item, i) => { expect(item.tone).toBe(english[i].tone); expect(item.label).toMatch(/[\u0600-\u06ff]/); });
  expect(describeLocationAccessSteps({ foreground: 'denied', background: 'denied', precise: false })[0].title).toBe('الموقع الدقيق');
});

test('mounted attendance count switches to Arabic dual and restores English without remounting', async () => {
  const screen = render(<HistorySectionHeader title="2026-10-29" count={2} />);
  expect(screen.getByText('2 entries')).toBeTruthy();
  await act(async () => { await setLanguage('ar'); });
  expect(screen.getByText('سجلان')).toBeTruthy();
  await act(async () => { await setLanguage('en'); });
  expect(screen.getByText('2 entries')).toBeTruthy();
  expect(translateMessage('Tenant message')).toBe('Tenant message');
});

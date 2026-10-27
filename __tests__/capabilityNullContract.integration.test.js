import { configureStore } from '@reduxjs/toolkit';
import MockAdapter from 'axios-mock-adapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RootReducer from '../redux/RootReducer';
import {
  settingsFailed, settingsReceived, settingsRequested,
  makeSelectFeatureEnabled, selectRouteEnabled,
} from '../redux/Slices/FeatureSettingsSlice';
import { setBaseUrl } from '../redux/Slices/UserSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { getAuthSessionGeneration } from '../utils/authSessionGuard';
import apiClient, { clearTokens, plainAxios, saveTokens } from '../services/api/apiClient';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import * as expenses from '../services/api/expense.service';
import * as leaves from '../services/api/leave.service';
import * as loans from '../services/api/loanApplication.service';
import * as complaints from '../services/api/complaint.service';
import * as attendance from '../services/api/attendance.service';
import * as records from '../services/api/records.service';
import { submitResignation } from '../services/api/resignation.service';
import { userFileUpload, putUserFile } from '../services/api/upload.service';

let mockStore;
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() || {},
  dispatch: action => mockStore?.dispatch(action),
} }));

const tenant = 'https://null-alpha.example.test';
const otherTenant = 'https://null-beta.example.test';
const employee = 'EMP-NULL-SYNTHETIC';
const file = { uri: 'file:///synthetic.pdf', name: 'synthetic.pdf', type: 'application/pdf' };
const endpoint = (method, owner = tenant) => `${owner}/api/method/employee_app.${method}`;
const settingsUrl = endpoint('gauth.employee_checkin_setting');
const expenseUrl = endpoint('attendance_api.create_expense_claim');
let mock;
let refresh;
let requestSequence = 0;
let originalFetch;

const makeStore = preloadedState => configureStore({ reducer: RootReducer, preloadedState });
const receive = (wire, owner = tenant) => mockStore.dispatch(settingsReceived({
  scope: buildSettingsScope(owner, employee), settings: normalizeFeatureSettings(wire),
}));
const enabled = path => makeSelectFeatureEnabled(path)(mockStore.getState());
const fetchSettings = async () => {
  const baseUrl = await AsyncStorage.getItem('baseUrl');
  const scope = buildSettingsScope(baseUrl, employee);
  const requestId = `null-contract-${++requestSequence}`;
  mockStore.dispatch(settingsRequested({ scope, requestId }));
  const result = await getFeatureSettings({ capabilityScope: {
    scope, baseUrl, employeeCode: employee, generation: getAuthSessionGeneration(),
  } });
  mockStore.dispatch(result.error
    ? settingsFailed({ error: result.error, requestId })
    : settingsReceived({ scope, requestId, settings: result.message }));
  return result;
};
const assertNoExecution = () => {
  expect(mock.history.get).toHaveLength(0);
  expect(mock.history.post).toHaveLength(0);
  expect(mock.history.put).toHaveLength(0);
  expect(global.fetch).not.toHaveBeenCalled();
};

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockStore = makeStore({ userAuth: { isLoggedIn: true }, user: {
    baseUrl: tenant, userDetails: { employeeCode: employee },
  } });
  await clearTokens();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([['baseUrl', tenant], ['employee_code', employee]]);
  await saveTokens('synthetic-null-access', 'synthetic-null-refresh');
  mock = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) });
});

afterEach(() => {
  mock.restore();
  refresh.restore();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('accepts an explicit-null-only settings response and replaces a previously allowed permission', async () => {
  receive({ expense_claim: true });
  mock.onGet(settingsUrl).reply(200, { message: { expense_claim: null } });
  expect(await fetchSettings()).toHaveProperty('message.expense_claim', false);
  expect(enabled('expense_claim')).toBe(false);
  mock.resetHistory();
  expect(await expenses.createExpenseClaim({ amount: 20 })).toHaveProperty('error');
  assertNoExecution();
});

it('hydrates received null denials through JSON persistence before any settings API is available', async () => {
  receive({ expense_claim: null, attendance_action: {
    photo_upload: null, employee_checkin_break: null,
  } });
  const persisted = JSON.parse(JSON.stringify(mockStore.getState()));
  mockStore = makeStore(persisted);
  expect(enabled('expense_claim')).toBe(false);
  expect(enabled('attendance_action.photo_upload')).toBe(false);
  expect(selectRouteEnabled(mockStore.getState(), 'Attendance camera')).toBe(false);
  mock.onGet(settingsUrl).networkError();
  expect(await fetchSettings()).toHaveProperty('error');
  mock.resetHistory();
  expect(await attendance.employeeBreak({ employeeCode: employee, type: 'IN' })).toMatchObject({ allowed: false });
  await expect(userFileUpload(file, 'CHECKIN-SYNTHETIC')).rejects.toThrow('Photo upload failed');
  assertNoExecution();
});

it('uses explicit null on a first successful cold-start response while omitted fields stay unknown', async () => {
  mock.onGet(settingsUrl).reply(200, { message: { loan_application: null } });
  await fetchSettings();
  expect(enabled('loan_application')).toBe(false);
  expect(enabled('leave_request')).toBe(true);
  expect(mockStore.getState().featureSettings.settings.leave_request).toBeNull();
});

it.each([{}, { message: {} }, { message: { expense_claim: { malformed: true } } }])(
  'keeps a received denial after a malformed successful settings response: %p', async body => {
    receive({ expense_claim: null });
    mock.onGet(settingsUrl).reply(200, body);
    expect(await fetchSettings()).toHaveProperty('error');
    expect(enabled('expense_claim')).toBe(false);
  },
);

it('preserves missing and malformed fields while replacing only explicit null fields in a partial refresh', async () => {
  receive({ expense_claim: true, leave_request: true, loan_application: true });
  mock.onGet(settingsUrl).reply(200, { message: { expense_claim: null, leave_request: 'malformed' } });
  await fetchSettings();
  expect(enabled('expense_claim')).toBe(false);
  expect(enabled('leave_request')).toBe(true);
  expect(enabled('loan_application')).toBe(true);
});

it('clears explicit-null version metadata without treating it as a Boolean feature permission', async () => {
  receive({ expense_claim: true, attendance_action: { offline_attendance: true, offline_attendance_version: '1' } });
  mock.onGet(settingsUrl).reply(200, { message: { attendance_action: { offline_attendance_version: null } } });
  expect(await fetchSettings()).toHaveProperty('message.attendance_action.offline_attendance_version', null);
  expect(enabled('expense_claim')).toBe(true);
  expect(enabled('attendance_action.offline_attendance')).toBe(true);
  expect(mockStore.getState().featureSettings.settings.attendance_action.offline_attendance_version).toBeNull();
});

it('keeps the newer explicit-null response when an older allow response arrives later', async () => {
  let completeOld;
  let startedOld;
  const oldStarted = new Promise(resolve => { startedOld = resolve; });
  mock.onGet(settingsUrl).replyOnce(() => {
    startedOld();
    return new Promise(resolve => { completeOld = resolve; });
  });
  mock.onGet(settingsUrl).reply(200, { message: { expense_claim: null } });
  const old = fetchSettings();
  await oldStarted;
  await fetchSettings();
  completeOld([200, { message: { expense_claim: true } }]);
  await old;
  expect(enabled('expense_claim')).toBe(false);
});

it('does not reuse a foreign tenant allow or denial after switching settings owners', async () => {
  receive({ expense_claim: true });
  await AsyncStorage.setItem('baseUrl', otherTenant);
  mockStore.dispatch(setBaseUrl(otherTenant));
  mock.onGet(endpoint('gauth.employee_checkin_setting', otherTenant))
    .reply(200, { message: { expense_claim: null } });
  await fetchSettings();
  expect(enabled('expense_claim')).toBe(false);
  mock.onPost(endpoint('attendance_api.create_expense_claim', otherTenant)).reply(200, {});
  await expect(apiClient.post(endpoint('attendance_api.create_expense_claim', otherTenant), {}))
    .rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mock.history.post).toHaveLength(0);
  await AsyncStorage.setItem('baseUrl', tenant);
  mockStore.dispatch(setBaseUrl(tenant));
  // A foreign denial does not invent a response for an uncached active scope.
  expect(enabled('expense_claim')).toBe(true);
});

it('rechecks explicit-null revocation before a 401 feature retry', async () => {
  receive({ expense_claim: true });
  mock.onPost(expenseUrl).replyOnce(401);
  mock.onPost(expenseUrl).reply(200, {});
  refresh.onPost(endpoint('gauth.create_refresh_token')).reply(() => {
    receive({ expense_claim: null });
    return [200, { data: { access_token: 'synthetic-null-rotated', refresh_token: 'synthetic-null-rotated-refresh' } }];
  });
  await expect(apiClient.post(expenseUrl, {})).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mock.history.post).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it('rejects an older tenant response after a new tenant has received its own explicit-null policy', async () => {
  let release;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  mock.onGet(settingsUrl).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const old = fetchSettings();
  await sent;
  await AsyncStorage.setItem('baseUrl', otherTenant);
  mockStore.dispatch(setBaseUrl(otherTenant));
  mock.onGet(endpoint('gauth.employee_checkin_setting', otherTenant))
    .reply(200, { message: { expense_claim: null } });
  await fetchSettings();
  release([200, { message: { expense_claim: true } }]);
  expect(await old).toHaveProperty('error');
  expect(mockStore.getState().featureSettings.scope).toBe(buildSettingsScope(otherTenant, employee));
  expect(enabled('expense_claim')).toBe(false);
});

it('stops a break mutation when explicit null arrives while the server clock is pending', async () => {
  receive({ attendance_action: { employee_checkin_break: true } });
  mock.onGet(endpoint('attendance_api.get_server_time')).reply(() => {
    receive({ attendance_action: { employee_checkin_break: null } });
    return [200, { message: { server_time: '2026-10-21 08:00:00' } }];
  });
  expect(await attendance.employeeBreak({ employeeCode: employee, type: 'IN' })).toMatchObject({ allowed: false });
  expect(mock.history.get).toHaveLength(1);
  expect(mock.history.post).toHaveLength(0);
});

it('rechecks explicit null at the last policy read before a raw fetch attachment upload', async () => {
  receive({ expense_claim: true });
  const read = AsyncStorage.getItem.getMockImplementation();
  let baseUrlReads = 0;
  AsyncStorage.getItem.mockImplementation(async key => {
    const value = await read(key);
    if (key === 'baseUrl' && ++baseUrlReads === 3) receive({ expense_claim: null });
    return value;
  });
  try {
    expect(await expenses.uploadExpenseAttachment(file, 'DOC-SYNTHETIC')).toHaveProperty('error');
    expect(baseUrlReads).toBe(3);
    assertNoExecution();
  } finally {
    AsyncStorage.getItem.mockImplementation(read);
  }
});

const operations = [
  ['expense list', 'expense_claim', () => expenses.getExpenseClaims()],
  ['expense types', 'expense_claim', () => expenses.getExpenseTypes()],
  ['expense mutation', 'expense_claim', () => expenses.createExpenseClaim({ amount: 20 })],
  ['expense fetch upload', 'expense_claim', () => expenses.uploadExpenseAttachment(file, 'DOC-SYNTHETIC')],
  ['leave list', 'leave_request', () => leaves.getLeaveApplications()],
  ['leave mutation', 'leave_request', () => leaves.createLeaveApplication({})],
  ['leave fetch upload', 'leave_request', () => leaves.uploadLeaveAttachment(file, 'DOC-SYNTHETIC')],
  ['loan read', 'loan_application', () => loans.getLoanProducts()],
  ['loan mutation', 'loan_application', () => loans.LoanApplicationRequest({})],
  ['complaint mutation', 'complaints', () => complaints.createComplaint({ message: 'Synthetic' })],
  ['complaint fetch upload', 'complaints', () => complaints.uploadComplaintAttachment(file, 'DOC-SYNTHETIC')],
  ['resignation mutation', 'employee_resignation', () => submitResignation({ reason: 'Synthetic' })],
  ['employee records read', 'employee_records', () => records.getShortcut1(employee)],
  ['attendance history read', 'attendance_action.attendance_history', () => attendance.getUserAttendance(employee)],
  ['attendance request read', 'attendance_action.attendance_request', () => attendance.getAttendanceRequests()],
  ['attendance request mutation', 'attendance_action.attendance_request', () => attendance.createAttendanceRequest({ employee })],
  ['attendance request fetch upload', 'attendance_action.attendance_request', () => attendance.uploadAttendanceAttachment(file, 'DOC-SYNTHETIC')],
  ['break read', 'attendance_action.employee_checkin_break', () => attendance.getTodayBreaks(employee, '2026-10-21')],
  ['break mutation', 'attendance_action.employee_checkin_break', () => attendance.employeeBreak({ employeeCode: employee, type: 'IN' })],
  ['automatic attendance mutation', 'attendance_action.geo_tagging', () => attendance.autoCheckInOut({ employeeCode: employee, type: 'IN' })],
  ['photo upload', 'attendance_action.photo_upload', () => userFileUpload(file, 'CHECKIN-SYNTHETIC')],
  ['photo association', 'attendance_action.photo_upload', () => putUserFile(employee)],
];

it.each(operations)('denies explicit-null %s at direct service execution', async (_name, path, invoke) => {
  const wire = path.startsWith('attendance_action.')
    ? { attendance_action: { [path.split('.')[1]]: null } }
    : { [path]: null };
  receive(wire);
  await Promise.resolve().then(invoke).catch(() => {});
  expect(enabled(path)).toBe(false);
  assertNoExecution();
});

it.each([
  ['expense mutation', 'expense_claim', () => apiClient.post(expenseUrl, {})],
  ['history read', 'attendance_action.attendance_history', () => apiClient.get(endpoint('attendance_api.get_attendance_details'))],
  ['break mutation', 'attendance_action.employee_checkin_break', () => apiClient.post(endpoint('attendance_api.Employee_break'), {})],
  ['photo upload', 'attendance_action.photo_upload', () => apiClient.post(endpoint('attendance_api.upload_file'), {}, {
    requiredCapability: 'attendance_action.photo_upload',
  })],
])('denies explicit-null %s for direct Axios callers', async (_name, path, invoke) => {
  receive(path.startsWith('attendance_action.')
    ? { attendance_action: { [path.split('.')[1]]: null } }
    : { [path]: null });
  await expect(invoke()).rejects.toMatchObject({ code: 'FEATURE_DISABLED', feature: path });
  assertNoExecution();
});

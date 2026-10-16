import MockAdapter from 'axios-mock-adapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { plainAxios, clearTokens, saveTokens } from '../services/api/apiClient';
import reducer, { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';

let mockRootState = {};
jest.mock('../redux/Store', () => ({ store: { getState: () => mockRootState, dispatch: jest.fn() } }));

const tenant = 'https://alpha.example.test';
const expense = `${tenant}/api/method/employee_app.attendance_api.create_expense_claim`;
const history = `${tenant}/api/method/employee_app.attendance_api.get_attendance_details`;
let mock;
let refresh;
const receive = wire => {
  mockRootState.featureSettings = reducer(mockRootState.featureSettings, settingsReceived({
    scope: buildSettingsScope(tenant, 'EMP-SYNTHETIC'),
    settings: normalizeFeatureSettings(wire),
  }));
};

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mock = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  await clearTokens();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([['baseUrl', tenant], ['employee_code', 'EMP-SYNTHETIC']]);
  await saveTokens('synthetic-access', 'synthetic-refresh');
  mockRootState = {};
  receive({ expense_claim: true });
});
afterEach(() => {
  mock.restore();
  refresh.restore();
  jest.restoreAllMocks();
});

it('blocks direct axios invocation before the transport and permits an enabled call', async () => {
  mock.onPost(expense).reply(200, { message: { name: 'SYNTHETIC' } });
  receive({ expense_claim: false });
  await expect(apiClient.post(expense, {})).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mock.history.post).toHaveLength(0);
  receive({ expense_claim: true });
  await expect(apiClient.post(expense, {})).resolves.toMatchObject({ status: 200 });
  expect(mock.history.post).toHaveLength(1);
});

it('rechecks a received revocation before retrying a 401', async () => {
  mock.onPost(expense).replyOnce(401);
  mock.onPost(expense).reply(200, {});
  refresh.onPost(`${tenant}/api/method/employee_app.gauth.create_refresh_token`).reply(() => {
    receive({ expense_claim: false });
    return [200, { data: { access_token: 'synthetic-rotated', refresh_token: 'synthetic-rotated-refresh' } }];
  });
  await expect(apiClient.post(expense, {})).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mock.history.post).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it('does not treat the login transport header as a feature-policy exemption', async () => {
  receive({ expense_claim: false });
  mock.onPost(expense).reply(200, {});
  await expect(apiClient.post(expense, {}, { headers: { 'x-skip-auth': 'true' } }))
    .rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mock.history.post).toHaveLength(0);
  const login = `${tenant}/api/method/employee_app.gauth.generate_token_secure`;
  mock.onPost(login).reply(200, { message: {} });
  await expect(apiClient.post(login, {}, { headers: { 'x-skip-auth': 'true' } })).resolves.toMatchObject({ status: 200 });
});

it('does not replay a feature request against a previous tenant after refresh', async () => {
  mock.onPost(expense).replyOnce(401);
  mock.onPost(expense).reply(200, {});
  refresh.onPost(`${tenant}/api/method/employee_app.gauth.create_refresh_token`).reply(async () => {
    await AsyncStorage.setItem('baseUrl', 'https://beta.example.test');
    return [200, { data: { access_token: 'synthetic-other', refresh_token: 'synthetic-other-refresh' } }];
  });
  await expect(apiClient.post(expense, {})).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_CHANGED' });
  expect(mock.history.post).toHaveLength(1);
});

it.each([200, 401])('rejects a delayed %s feature response after tenant change before follow-up work or refresh', async status => {
  let release;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  mock.onPost(expense).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const followUpUpload = jest.fn();
  const operation = apiClient.post(expense, {}).then(followUpUpload);
  await sent;
  await AsyncStorage.setItem('baseUrl', 'https://beta.example.test');
  release([status, { message: { id: 'SYNTHETIC-ALPHA-DOC' } }]);
  await expect(operation).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_CHANGED' });
  expect(followUpUpload).not.toHaveBeenCalled();
  expect(refresh.history.post).toHaveLength(0);
});

it('preserves success already dispatched before a same-owner feature revocation', async () => {
  mock.onPost(expense).reply(() => {
    receive({ expense_claim: false });
    return [200, { message: { id: 'SYNTHETIC' } }];
  });
  await expect(apiClient.post(expense, {})).resolves.toMatchObject({ status: 200 });
});

it('separates optional history from the private essential session-status read', async () => {
  receive({ attendance_action: { attendance_history: false } });
  mock.onGet(history).reply(200, { message: [] });
  await expect(apiClient.get(history)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await expect(apiClient.get(history, { attendanceStatusRead: true })).resolves.toMatchObject({ status: 200 });
  expect(mock.history.get).toHaveLength(1);
});

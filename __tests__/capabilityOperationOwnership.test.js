import MockAdapter from 'axios-mock-adapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { clearTokens, saveTokens } from '../services/api/apiClient';
import { assertCapability } from '../services/capabilityPolicy';
import reducer, { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { createExpenseClaim, uploadExpenseAttachment } from '../services/api/expense.service';
import { createLeaveApplication, uploadLeaveAttachment } from '../services/api/leave.service';
import { createComplaint, uploadComplaintAttachment } from '../services/api/complaint.service';
import { createAttendanceRequest, uploadAttendanceAttachment } from '../services/api/attendance.service';

let mockRootState = {};
jest.mock('../redux/Store', () => ({ store: { getState: () => mockRootState, dispatch: jest.fn() } }));

const alpha = 'https://ownership-alpha.example.test';
const beta = 'https://ownership-beta.example.test';
const employee = 'EMP-SYNTHETIC';
const docname = 'SYNTHETIC-ALPHA-DOC';
const file = { uri: 'file:///synthetic.pdf', name: 'synthetic.pdf', type: 'application/pdf' };
const enabled = {
  expense_claim: true,
  leave_request: true,
  complaints: true,
  attendance_action: { attendance_request: true },
};
const flows = [
  ['expense', 'expense_claim', options => createExpenseClaim({ amount: 1 }, options), uploadExpenseAttachment,
    result => result?.message?.name],
  ['leave', 'leave_request', options => createLeaveApplication({}, options), uploadLeaveAttachment,
    result => result?.message?.message?.name],
  ['complaint', 'complaints', options => createComplaint({ message: 'Synthetic complaint' }, options), uploadComplaintAttachment,
    result => result?.message?.message?.name],
  ['attendance request', 'attendance_action.attendance_request', options => createAttendanceRequest({ employee }, options), uploadAttendanceAttachment,
    result => result?.docname],
];
let mock;
let originalFetch;

const receive = (tenant, wire = enabled) => {
  mockRootState.featureSettings = reducer(mockRootState.featureSettings, settingsReceived({
    scope: buildSettingsScope(tenant, employee),
    settings: normalizeFeatureSettings(wire),
  }));
};
const signIn = async tenant => {
  await clearTokens();
  await AsyncStorage.multiSet([['baseUrl', tenant], ['employee_code', employee]]);
  await saveTokens('synthetic-current-access', 'synthetic-current-refresh');
  receive(tenant);
};
const settle = operation => Promise.resolve().then(operation).catch(error => ({ error }));
const expectNoNetwork = () => {
  expect(mock.history.get).toHaveLength(0);
  expect(mock.history.post).toHaveLength(0);
  expect(global.fetch).not.toHaveBeenCalled();
};

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.clear();
  mockRootState = {};
  await signIn(alpha);
  mock = new MockAdapter(apiClient);
  mock.onGet().reply(200, { message: { server_time: '2026-10-16 08:30:00' } });
  mock.onPost().reply(200, { message: { name: docname } });
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ message: ['/files/synthetic.pdf'] }) });
});
afterEach(() => {
  mock.restore();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it.each(flows)('preserves enabled %s create and follow-up attachment results for one owner', async (_name, feature, create, upload, resultDocname) => {
  const capabilityScope = await assertCapability(feature);
  const result = await create({ capabilityScope });
  expect(resultDocname(result)).toBe(docname);
  expect(mock.history.post).toHaveLength(1);
  const uploaded = await upload(file, docname, { capabilityScope });
  expect(uploaded).not.toHaveProperty('error');
  expect(global.fetch).toHaveBeenCalledWith(`${alpha}/api/method/employee_app.attendance_api.upload_file`, expect.objectContaining({
    method: 'POST', headers: { Authorization: 'Bearer synthetic-current-access' },
  }));
});

it.each(flows)('refuses an old-owner %s create after switching to an enabled tenant with the same employee code', async (_name, feature, create) => {
  const capabilityScope = await assertCapability(feature);
  await signIn(beta);
  const result = await settle(() => create({ capabilityScope }));
  expect(result.error || result.success === false).toBeTruthy();
  expectNoNetwork();
});

it.each(flows)('refuses an old-owner %s attachment after the create already succeeded and the tenant changed', async (_name, feature, create, upload, resultDocname) => {
  const capabilityScope = await assertCapability(feature);
  expect(resultDocname(await create({ capabilityScope }))).toBe(docname);
  await signIn(beta);
  mock.resetHistory();
  const result = await settle(() => upload(file, docname, { capabilityScope }));
  expect(result.error).toBeTruthy();
  expectNoNetwork();
});

it.each(flows)('refuses a retained %s operation after same-tenant reauthentication', async (_name, feature, create, upload) => {
  const capabilityScope = await assertCapability(feature);
  await signIn(alpha);
  await settle(() => create({ capabilityScope }));
  await settle(() => upload(file, docname, { capabilityScope }));
  expectNoNetwork();
});

it.each(flows)('rejects a %s follow-up upload when its auth read finishes after a tenant switch', async (_name, feature, _create, upload) => {
  const capabilityScope = await assertCapability(feature);
  const originalRead = AsyncStorage.getItem.getMockImplementation();
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let finishRead;
  const delayedRead = new Promise(resolve => { finishRead = resolve; });
  let baseReads = 0;
  AsyncStorage.getItem.mockImplementation(key => {
    // The first read validates the captured owner; the second constructs the
    // raw upload's auth context. The operation must retain its original owner.
    if (key === 'baseUrl' && ++baseReads === 2) {
      markReadStarted();
      return delayedRead;
    }
    return originalRead(key);
  });
  try {
    const pending = settle(() => upload(file, docname, { capabilityScope }));
    await readStarted;
    await signIn(beta);
    finishRead(beta);
    const result = await pending;
    expect(result.error).toBeTruthy();
    expectNoNetwork();
  } finally {
    AsyncStorage.getItem.mockImplementation(originalRead);
  }
});

it('keeps expense HTTP failure diagnostics free of Authorization, request bodies and response bodies', async () => {
  const privateDescription = 'SYNTHETIC-PRIVATE-EXPENSE-DESCRIPTION';
  const privateServerMessage = 'SYNTHETIC-PRIVATE-BACKEND-MESSAGE';
  mock.resetHandlers();
  mock.onPost(`${alpha}/api/method/employee_app.attendance_api.create_expense_claim`)
    .reply(403, { message: privateServerMessage });
  const result = await createExpenseClaim({ amount: 1, description: privateDescription });
  expect(result).toHaveProperty('error');
  expect(mock.history.post).toHaveLength(1);
  expect(mock.history.post[0].headers.Authorization).toBe('Bearer synthetic-current-access');
  const diagnostics = JSON.stringify(console.log.mock.calls);
  for (const sensitive of ['synthetic-current-access', 'Authorization', privateDescription, privateServerMessage]) {
    expect(diagnostics).not.toContain(sensitive);
  }
  expect(console.log.mock.calls.some(call => call[1]?.httpStatus === 403)).toBe(true);
});

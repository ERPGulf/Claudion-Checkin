import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useComplaint from '../hooks/useComplaint';
import useExpenseClaims from '../hooks/useExpenseClaims';
import { createExpenseClaim, uploadExpenseAttachment } from '../services/api';
import * as complaints from '../services/api/complaint.service';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

let mockRoot;
let mockMutation;
jest.mock('../redux/Store', () => ({ store: { getState: () => mockRoot } }));
jest.mock('react-redux', () => ({ useSelector: () => 'EMP-SYNTHETIC' }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], refetch: async () => {} }),
  useMutation: options => {
    mockMutation = options;
    return { mutate: jest.fn(), isPending: false };
  },
}));
jest.mock('../services/api', () => ({
  createExpenseClaim: jest.fn(), uploadExpenseAttachment: jest.fn(), getExpenseClaims: jest.fn(),
}));
jest.mock('../hooks/useAttachmentPicker', () => ({ useAttachmentPicker: () => ({}) }));
jest.mock('../utils/HapticsMessage', () => ({ hapticsMessage: jest.fn() }));

const alpha = 'https://operation-alpha.example.test';
const beta = 'https://operation-beta.example.test';
const employeeCode = 'EMP-SYNTHETIC';
const file = { uri: 'file:///synthetic.pdf', name: 'synthetic.pdf', type: 'application/pdf' };
const install = (tenant, enabled = true) => {
  mockRoot = { featureSettings: {
    scope: buildSettingsScope(tenant, employeeCode),
    settings: normalizeFeatureSettings({ complaints: enabled, expense_claim: enabled }),
    status: 'success', lastFetchedAt: Date.now(),
  } };
};
const changeTenant = async () => {
  await AsyncStorage.setItem('baseUrl', beta);
  install(beta);
};
let create;
beforeEach(async () => {
  jest.clearAllMocks();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', alpha], ['employee_code', employeeCode], ['access_token', 'synthetic-access'],
  ]);
  install(alpha);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  create = jest.spyOn(complaints, 'createComplaint').mockResolvedValue({ message: { message: { name: 'ALPHA-COMPLAINT' } } });
  createExpenseClaim.mockResolvedValue({ id: 'ALPHA-EXPENSE' });
  uploadExpenseAttachment.mockResolvedValue({ message: ['synthetic-file'] });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ message: ['synthetic-file'] }) });
});
afterEach(() => jest.restoreAllMocks());
const mountForm = async () => {
  const hook = renderHook(() => useComplaint());
  await act(async () => { hook.result.current.setMessage('Synthetic complaint'); hook.result.current.setFile(file); });
  return hook;
};

it('passes the create owner through to the real upload without changing backend file fields', async () => {
  const hook = await mountForm();
  await act(async () => { await hook.result.current.submitComplaint(); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ message: 'Synthetic complaint' }), {
    capabilityScope: expect.objectContaining({ scope: buildSettingsScope(alpha, employeeCode) }),
  });
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(alpha), expect.objectContaining({ method: 'POST' }));
  const body = global.fetch.mock.calls[0][1].body;
  const field = key => typeof body.get === 'function' ? body.get(key) : body._parts.find(part => part[0] === key)?.[1];
  expect(field('docname')).toBe('ALPHA-COMPLAINT');
  expect(field('capabilityScope')).toBeFalsy();
  expect(Alert.alert).toHaveBeenCalledWith('Success', 'Complaint submitted successfully');
});

it.each(['tenant', 'reauth', 'revocation'])('does not upload an accepted document after an inter-step %s change', async change => {
  create.mockImplementationOnce(async () => {
    // Simulate a successful create already delivered just before the next step.
    if (change === 'tenant') await changeTenant();
    else if (change === 'reauth') {
      invalidateAuthSession();
      activateAuthSession(getAuthSessionGeneration());
    } else install(alpha, false);
    return { message: { message: { name: 'ALPHA-COMPLAINT' } } };
  });
  const hook = await mountForm();
  await act(async () => { await hook.result.current.submitComplaint(); });
  expect(create).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(hook.result.current.file).toEqual(file);
  expect(Alert.alert).not.toHaveBeenCalledWith('Success', 'Complaint submitted successfully');
});

it('refuses a retained submit handler from a previous authentication generation before create', async () => {
  const hook = await mountForm();
  const retained = hook.result.current.submitComplaint;
  invalidateAuthSession();
  activateAuthSession(getAuthSessionGeneration());
  await act(async () => { await retained(); });
  expect(create).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('retains the expense creation owner in its follow-up upload callback', async () => {
  renderHook(() => useExpenseClaims());
  const variables = { amount: 1, file_url: file };
  let result;
  await act(async () => { result = await mockMutation.mutationFn(variables); });
  const owner = createExpenseClaim.mock.calls[0][1].capabilityScope;
  expect(owner.scope).toBe(buildSettingsScope(alpha, employeeCode));
  await act(async () => { await mockMutation.onSuccess(result, variables); });
  expect(uploadExpenseAttachment).toHaveBeenCalledWith(file, 'ALPHA-EXPENSE', { capabilityScope: owner });
});

it('does not treat a refused expense create as a successful mutation', async () => {
  createExpenseClaim.mockResolvedValue({ error: 'Feature disabled.' });
  renderHook(() => useExpenseClaims());
  await act(async () => {
    await expect(mockMutation.mutationFn({ amount: 1 })).rejects.toThrow('Feature disabled.');
  });
  expect(uploadExpenseAttachment).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalledWith('Success', expect.anything(), expect.anything());
});

it('reports an expense attachment refusal while preserving its accepted create', async () => {
  uploadExpenseAttachment.mockResolvedValue({ error: 'Feature disabled.' });
  renderHook(() => useExpenseClaims());
  const variables = { amount: 1, file_url: file };
  await act(async () => {
    const result = await mockMutation.mutationFn(variables);
    await mockMutation.onSuccess(result, variables);
  });
  expect(Alert.alert).toHaveBeenCalledWith('Warning', 'Expense created, but file upload failed.');
  expect(Alert.alert).toHaveBeenCalledWith('Success', 'Expense claim submitted successfully!', expect.any(Array));
});

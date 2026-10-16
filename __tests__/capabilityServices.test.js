import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api/apiClient';
import { assertCapability } from '../services/capabilityPolicy';
import * as expenses from '../services/api/expense.service';
import * as leaves from '../services/api/leave.service';
import * as loans from '../services/api/loanApplication.service';
import * as complaints from '../services/api/complaint.service';
import * as attendance from '../services/api/attendance.service';
import * as records from '../services/api/records.service';
import { submitResignation } from '../services/api/resignation.service';
import { userFileUpload, putUserFile } from '../services/api/upload.service';

jest.mock('../services/capabilityPolicy', () => ({ assertCapability: jest.fn() }));
jest.mock('../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const employee = 'EMP-SYNTHETIC';
const file = { uri: 'file:///synthetic.pdf', name: 'synthetic.pdf', type: 'application/pdf' };
const operations = [
  ['expense list', 'expense_claim', () => expenses.getExpenseClaims()],
  ['expense types', 'expense_claim', () => expenses.getExpenseTypes()],
  ['expense creation', 'expense_claim', () => expenses.createExpenseClaim({})],
  ['expense attachment', 'expense_claim', () => expenses.uploadExpenseAttachment(file, 'DOC-1')],
  ['leave types', 'leave_request', () => leaves.getLeaveTypes()],
  ['leave list', 'leave_request', () => leaves.getLeaveApplications()],
  ['leave creation', 'leave_request', () => leaves.createLeaveApplication({})],
  ['leave attachment', 'leave_request', () => leaves.uploadLeaveAttachment(file, 'DOC-1')],
  ['loan products', 'loan_application', () => loans.getLoanProducts()],
  ['loan list', 'loan_application', () => loans.getLoanApplications()],
  ['loan creation', 'loan_application', () => loans.LoanApplicationRequest({})],
  ['complaint creation', 'complaints', () => complaints.createComplaint({ message: 'Synthetic' })],
  ['complaint attachment', 'complaints', () => complaints.uploadComplaintAttachment(file, 'DOC-1')],
  ['resignation', 'employee_resignation', () => submitResignation({ reason: 'Synthetic' })],
  ['records 1', 'employee_records', () => records.getShortcut1(employee)],
  ['records 2', 'employee_records', () => records.getShortcut2(employee)],
  ['records 3', 'employee_records', () => records.getShortcut3(employee)],
  ['attendance history', 'attendance_action.attendance_history', () => attendance.getUserAttendance(employee)],
  ['attendance request list', 'attendance_action.attendance_request', () => attendance.getAttendanceRequests()],
  ['attendance request creation', 'attendance_action.attendance_request', () => attendance.createAttendanceRequest({ employee })],
  ['attendance request attachment', 'attendance_action.attendance_request', () => attendance.uploadAttendanceAttachment(file, 'DOC-1')],
  ['break read', 'attendance_action.employee_checkin_break', () => attendance.getTodayBreaks(employee, '2026-10-16')],
  ['break creation', 'attendance_action.employee_checkin_break', () => attendance.employeeBreak({ employeeCode: employee, type: 'IN' })],
  ['automatic attendance', 'attendance_action.auto_attendance', () => attendance.autoCheckInOut({ employeeCode: employee, type: 'IN' })],
  ['attendance photo', 'attendance_action.photo_upload', () => userFileUpload(file, 'DOC-1')],
  ['attendance photo association', 'attendance_action.photo_upload', () => putUserFile(employee)],
];

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', 'https://tenant.example'],
    ['access_token', 'synthetic-access'],
    ['employee_code', employee],
  ]);
  assertCapability.mockResolvedValue(undefined);
  const reply = { data: { message: { name: 'DOC-1', server_time: '2026-10-16 08:30:00' } } };
  apiClient.get.mockResolvedValue(reply);
  apiClient.post.mockResolvedValue(reply);
  apiClient.put.mockResolvedValue(reply);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) });
});

afterEach(() => jest.restoreAllMocks());

it.each(operations)('refuses direct disabled %s invocation before any network call', async (_name, capability, invoke) => {
  assertCapability.mockImplementation(async path => {
    if (path === capability) throw Object.assign(new Error('Feature disabled.'), { code: 'FEATURE_DISABLED' });
  });
  await Promise.resolve().then(invoke).catch(() => {});
  expect(assertCapability).toHaveBeenCalledWith(capability, expect.objectContaining({ baseUrl: 'https://tenant.example' }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each(operations)('preserves network execution for enabled %s', async (_name, capability, invoke) => {
  await Promise.resolve().then(invoke).catch(() => {});
  expect(assertCapability).toHaveBeenCalledWith(capability, expect.objectContaining({ baseUrl: 'https://tenant.example' }));
  const calls = apiClient.get.mock.calls.length + apiClient.post.mock.calls.length + apiClient.put.mock.calls.length + global.fetch.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
});

it('retains essential attendance-session status when history is disabled', async () => {
  assertCapability.mockRejectedValue(Object.assign(new Error('Feature disabled.'), { code: 'FEATURE_DISABLED' }));
  apiClient.get.mockResolvedValue({ data: { message: [] } });
  expect(await attendance.getAttendanceStatus()).toEqual({ custom_in: 0 });
  expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('get_attendance_details'), expect.objectContaining({ attendanceStatusRead: true }));
  expect(assertCapability).not.toHaveBeenCalled();
});

it('rechecks automatic policy after the awaited server-clock request', async () => {
  assertCapability.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('Feature disabled.'), { code: 'FEATURE_DISABLED' }));
  expect(await attendance.autoCheckInOut({ employeeCode: employee, type: 'IN' })).toMatchObject({ allowed: false });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each([
  ['expense_claim', () => expenses.uploadExpenseAttachment(file, 'DOC-1')],
  ['leave_request', () => leaves.uploadLeaveAttachment(file, 'DOC-1')],
  ['complaints', () => complaints.uploadComplaintAttachment(file, 'DOC-1')],
  ['attendance_action.attendance_request', () => attendance.uploadAttendanceAttachment(file, 'DOC-1')],
])('binds raw %s uploads to their original session through the final check', async (capability, invoke) => {
  const snapshot = { scope: 'https://tenant.example::EMP-SYNTHETIC', generation: 4 };
  assertCapability.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(Object.assign(new Error('Account changed.'), { code: 'CAPABILITY_SCOPE_CHANGED' }));
  await Promise.resolve().then(invoke).catch(() => {});
  expect(assertCapability).toHaveBeenLastCalledWith(capability, snapshot);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('preserves the photo association caller that supplies legacy FormData', async () => {
  const form = new FormData();
  form.append('custom_image', '/files/synthetic.jpg');
  await putUserFile(form, 'DOC-1');
  expect(assertCapability).toHaveBeenCalledWith('attendance_action.photo_upload', { baseUrl: 'https://tenant.example' });
  expect(apiClient.put).toHaveBeenCalledTimes(1);
});

it('does not expose the essential session-status exception through the public history helper', async () => {
  assertCapability.mockRejectedValue(Object.assign(new Error('Feature disabled.'), { code: 'FEATURE_DISABLED' }));
  expect(await attendance.getUserAttendance(employee, 0, 20, { attendanceStatusRead: true })).toHaveProperty('error');
  expect(apiClient.get).not.toHaveBeenCalled();
});

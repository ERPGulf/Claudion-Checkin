import { capabilityForRequest } from '../services/api/capabilityRequests';

const request = (method, extra = {}) => ({
  url: `https://tenant.example/api/method/${method}`,
  ...extra,
});

it.each([
  ['get_loan_product', 'loan_application'],
  ['create_loan_application', 'loan_application'],
  ['get_expense_claims', 'expense_claim'],
  ['get_expense_claim_type', 'expense_claim'],
  ['create_expense_claim', 'expense_claim'],
  ['create_leave_application', 'leave_request'],
  ['get_leave_type', 'leave_request'],
  ['create_complaint', 'complaints'],
  ['get_shortcut_1', 'employee_records'],
  ['get_shortcut_2', 'employee_records'],
  ['get_shortcut_3', 'employee_records'],
  ['Employee_break', 'attendance_action.employee_checkin_break'],
  ['get_today_breaks', 'attendance_action.employee_checkin_break'],
])('maps the %s endpoint to %s', (method, capability) => {
  expect(capabilityForRequest(request(`employee_app.attendance_api.${method}`))).toBe(capability);
});

it.each([
  ['list_loan_application', 'loan_application'],
  ['list_leave_application', 'leave_request'],
  ['list_attendance_request', 'attendance_action.attendance_request'],
])('maps employee list %s', (method, capability) => {
  expect(capabilityForRequest(request(`employee_app.employee_list.${method}`))).toBe(capability);
});

it('maps attendance requests and resignation without changing their method spelling', () => {
  expect(capabilityForRequest(request('employee_app.gauth.create_attendence_request'))).toBe('attendance_action.attendance_request');
  expect(capabilityForRequest(request('employee_app.employee_app_for_erpnext.doctype.employee_resignation.employee_resignation.create_employee_resignation'))).toBe('employee_resignation');
});

it('distinguishes optional history from essential private session-status reads', () => {
  const config = request('employee_app.attendance_api.get_attendance_details');
  expect(capabilityForRequest(config)).toBe('attendance_action.attendance_history');
  expect(capabilityForRequest({ ...config, attendanceStatusRead: true })).toBeNull();
});

it.each([true, 1, 'true', '1'])('guards automatic punches represented as %s', auto => {
  for (const data of [{ auto }, JSON.stringify({ auto }), new URLSearchParams({ auto })]) {
    expect(capabilityForRequest(request('employee_app.attendance_api.add_log_based_on_employee_field', { data }))).toBe('attendance_action.geo_tagging');
  }
});

it.each([false, 0, 'false', '0', undefined])('keeps manual attendance independent of automatic policy (%s)', auto => {
  expect(capabilityForRequest(request('employee_app.attendance_api.add_log_based_on_employee_field', { data: { auto } }))).toBeNull();
});

it.each([
  ['Expense Claim', 'expense_claim'],
  ['Leave Application', 'leave_request'],
  ['Employee Complaint', 'complaints'],
  ['Attendance Request', 'attendance_action.attendance_request'],
  ['Employee Checkin', 'attendance_action.photo_upload'],
])('guards %s uploads in both web and native FormData shapes', (doctype, capability) => {
  for (const data of [{ get: key => key === 'doctype' ? doctype : null }, { _parts: [['doctype', doctype]] }]) {
    expect(capabilityForRequest(request('employee_app.attendance_api.upload_file', { data }))).toBe(capability);
  }
});

it('supports relative paths, query strings and explicit metadata for shared endpoints', () => {
  expect(capabilityForRequest({ url: 'method/employee_app.attendance_api.get_loan_product?unused=1' })).toBe('loan_application');
  expect(capabilityForRequest(request('employee_app.attendance_api.employee', { requiredCapability: 'attendance_action.photo_upload' }))).toBe('attendance_action.photo_upload');
});

it.each(['get_employee_data', 'get_server_time', 'get_total_hours', 'get_monthly_hours', 'employee', 'qr_code', 'add_offline_employee_checkins', 'contract_list'])('keeps shared or independent %s methods outside optional feature mapping', method => {
  expect(capabilityForRequest(request(`employee_app.attendance_api.${method}`))).toBeNull();
});

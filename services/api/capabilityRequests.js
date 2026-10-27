import { ATTENDANCE_FEATURES } from '../../utils/featureSettings';

/**
 * Feature-specific wire methods. Shared employee, clock, totals and QR methods
 * intentionally have no feature gate: attendance/session restoration uses them.
 */
const METHOD_CAPABILITIES = {
  'employee_app.attendance_api.get_loan_product': 'loan_application',
  'employee_app.attendance_api.create_loan_application': 'loan_application',
  'employee_app.employee_list.list_loan_application': 'loan_application',
  'employee_app.attendance_api.get_expense_claims': 'expense_claim',
  'employee_app.attendance_api.get_expense_claim_type': 'expense_claim',
  'employee_app.attendance_api.create_expense_claim': 'expense_claim',
  'employee_app.attendance_api.create_leave_application': 'leave_request',
  'employee_app.attendance_api.get_leave_type': 'leave_request',
  'employee_app.employee_list.list_leave_application': 'leave_request',
  'employee_app.attendance_api.create_complaint': 'complaints',
  'employee_app.employee_app_for_erpnext.doctype.employee_resignation.employee_resignation.create_employee_resignation': 'employee_resignation',
  'employee_app.attendance_api.get_shortcut_1': 'employee_records',
  'employee_app.attendance_api.get_shortcut_2': 'employee_records',
  'employee_app.attendance_api.get_shortcut_3': 'employee_records',
  'employee_app.attendance_api.Employee_break': 'attendance_action.employee_checkin_break',
  'employee_app.attendance_api.get_today_breaks': 'attendance_action.employee_checkin_break',
  'employee_app.gauth.create_attendence_request': 'attendance_action.attendance_request',
  'employee_app.employee_list.list_attendance_request': 'attendance_action.attendance_request',
};

const UPLOAD_CAPABILITIES = {
  'Expense Claim': 'expense_claim',
  'Leave Application': 'leave_request',
  'Employee Complaint': 'complaints',
  'Attendance Request': 'attendance_action.attendance_request',
  'Employee Checkin': 'attendance_action.photo_upload',
};

export function requestField(data, key) {
  if (!data) return undefined;
  if (typeof data.get === 'function') return data.get(key);
  // React Native FormData exposes its entries as _parts, not get().
  if (Array.isArray(data._parts)) {
    return data._parts.find(part => part[0] === key)?.[1];
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)?.[key];
    } catch {
      return new URLSearchParams(data).get(key);
    }
  }
  return data[key];
}

/** Pure mapping used on every dispatch, including a retry after token refresh. */
export function capabilityForRequest(config = {}) {
  const method = String(config.url || '').match(/(?:^|\/)method\/([^?#]+)/)?.[1];
  const feature = METHOD_CAPABILITIES[method];
  if (feature) return feature;

  if (method === 'employee_app.attendance_api.get_attendance_details') {
    return config.attendanceStatusRead === true
      ? null
      : 'attendance_action.attendance_history';
  }
  if (method === 'employee_app.attendance_api.add_log_based_on_employee_field') {
    const automatic = requestField(config.data, 'auto');
    return automatic === true || automatic === 1 || automatic === 'true' || automatic === '1'
      ? ATTENDANCE_FEATURES.AUTO_ATTENDANCE
      : null;
  }
  if (method === 'employee_app.attendance_api.upload_file') {
    return UPLOAD_CAPABILITIES[requestField(config.data, 'doctype')] || config.requiredCapability || null;
  }
  // The photo-association endpoint also updates essential employee attendance
  // status, so the photo caller supplies metadata rather than gating all PUTs.
  return config.requiredCapability || null;
}

export default capabilityForRequest;

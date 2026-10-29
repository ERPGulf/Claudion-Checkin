import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { setLanguage, t, translateMessage } from '../localization';
import { formatExpenseDate, formatExpenseAmount, describeExpenseStatus, toWireDate } from '../utils/expenseClaims';
import { countLeaveDays, formatLeaveDuration } from '../utils/leaveRequest';
import { describeRecordStatus } from '../utils/records';
import { describeMissingLoanFields, LOAN_REPAYMENT_METHODS } from '../utils/loanApplication';
import { formatResignationDate } from '../utils/resignation';
import { formatFieldTime } from '../utils/attendanceRequest';
import ExpenseHistoryCard from '../components/ExpenseClaim/ExpenseHistoryCard';
import OptionSheet from '../components/common/OptionSheet';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../hooks/useAppTheme', () => () => ({ colors: require('../constants').COLORS, isDark: false }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

beforeEach(async () => { await act(async () => { await setLanguage('en'); }); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

test('HR display changes locale while date and amount contracts stay unchanged', async () => {
  const date = new Date(2026, 7, 5, 15, 12, 30);
  const wire = toWireDate(date);
  const resignationWire = formatResignationDate(date);
  expect(formatExpenseDate(wire)).toBe('5 Aug 2026');
  expect(formatExpenseAmount('1250')).toBe('1,250.00');
  await setLanguage('ar');
  expect(formatExpenseDate(wire)).toMatch(/أغسطس/);
  expect(formatExpenseDate(wire)).toContain('2026');
  expect(describeExpenseStatus('Approved').label).toMatch(/[\u0600-\u06ff]/);
  expect(describeRecordStatus('Rejected').label).toBe('مرفوض');
  expect(describeRecordStatus('Tenant workflow status').label).toBe('Tenant workflow status');
  expect(formatFieldTime(date, true)).toBe('15:12');
  expect(toWireDate(date)).toBe(wire);
  expect(formatResignationDate(date)).toBe(resignationWire);
  expect(LOAN_REPAYMENT_METHODS).toEqual(['Repay Fixed Amount per Period']);
});

test('leave duration uses all Arabic plural categories without changing inclusive day arithmetic', async () => {
  const from = new Date(2026, 7, 5, 23, 59);
  const to = new Date(2026, 7, 7, 1);
  expect(countLeaveDays(from, to)).toBe(3);
  await setLanguage('ar');
  expect([0, 1, 2, 3, 11, 102].map(formatLeaveDuration)).toEqual([
    'لا توجد أيام', 'يوم واحد', 'يومان', '3 أيام', '11 يومًا', '102 يوم',
  ]);
  expect(countLeaveDays(from, to)).toBe(3);
});

test('missing-field summary joins localized field names using the selected language', async () => {
  const fields = { productMissing: true, amountInvalid: true, repaymentMethodMissing: true };
  expect(describeMissingLoanFields(fields)).toBe('Add a loan product, a valid amount and a repayment method.');
  await setLanguage('ar');
  const message = describeMissingLoanFields(fields);
  expect(message).toContain('نوع القرض');
  expect(message).toContain('طريقة السداد');
  expect(message).not.toMatch(/Add| and |loan/);
});

test('mounted expense card updates status and date when switching languages, preserving tenant text', async () => {
  const claim = { expense_type: 'Tenant travel', description: 'Taxi EMP-001', amount: 1250, expense_date: '2026-08-05', status: 'Approved' };
  const screen = render(<ExpenseHistoryCard claim={claim} />);
  expect(screen.getByText('Approved')).toBeTruthy();
  expect(screen.getByText('5 Aug 2026')).toBeTruthy();
  await act(async () => { await setLanguage('ar'); });
  expect(screen.getByText(t('Approved'))).toBeTruthy();
  expect(screen.getByText('Tenant travel')).toBeTruthy();
  expect(screen.getByText('Taxi EMP-001')).toBeTruthy();
  await act(async () => { await setLanguage('en'); });
  expect(screen.getByText('Approved')).toBeTruthy();
  expect(claim.expense_date).toBe('2026-08-05');
});

test('translated repayment option keeps its backend value and current selection', async () => {
  await setLanguage('ar');
  const onSelect = jest.fn();
  const method = LOAN_REPAYMENT_METHODS[0];
  const screen = render(<OptionSheet visible title={t('Repayment method')} options={LOAN_REPAYMENT_METHODS} labelForOption={t} selected={method} onSelect={onSelect} onClose={() => {}} />);
  const option = screen.getByLabelText(t(method));
  expect(option.props.accessibilityState.selected).toBe(true);
  fireEvent.press(option);
  expect(onSelect).toHaveBeenCalledWith(method);
  expect(method).toBe('Repay Fixed Amount per Period');
});

test('app-owned service failures translate at presentation while backend content retains its contract', async () => {
  await setLanguage('ar');
  const appOwned = 'Unable to submit loan application.';
  expect(translateMessage(appOwned)).toBe('تعذّر إرسال طلب القرض.');
  expect(appOwned).toBe('Unable to submit loan application.');
  expect(translateMessage('Tenant-specific validation response')).toBe('Tenant-specific validation response');
});

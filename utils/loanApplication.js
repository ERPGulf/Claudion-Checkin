import { formatExpenseAmount, formatExpenseDate } from './expenseClaims';
import { describeRecordStatus } from './records';

/**
 * Glyph per loan product.
 *
 * Products are tenant-configured strings from
 * `employee_app.attendance_api.get_loan_product` — "Car Loan", "Housing
 * Advance", "test" — so the match is on a substring rather than an exact name,
 * the same rule `leaveTypeIcon` and `expenseTypeIcon` follow. The icon is
 * decoration only: it never reaches the payload, which always carries the raw
 * `product_name`.
 */
const PRODUCT_ICONS = [
  [/car|vehicle|auto/i, 'car-outline'],
  [/hous|home|rent|mortgage|property/i, 'home-outline'],
  [/educat|school|tuition|study|course/i, 'school-outline'],
  [/medical|health|treat|hospital/i, 'medkit-outline'],
  [/travel|trip|flight|ticket/i, 'airplane-outline'],
  [/marriage|wedding/i, 'heart-outline'],
  [/emergen|urgent/i, 'alert-circle-outline'],
  [/salary|advance|payroll/i, 'cash-outline'],
  [/personal|staff|employee/i, 'person-outline'],
];

export function loanProductIcon(product) {
  const match = PRODUCT_ICONS.find(([pattern]) => pattern.test(product || ''));
  // A wallet rather than a wrong picture: an unrecognised product is still a
  // loan.
  return match ? match[1] : 'wallet-outline';
}

/**
 * The repayment plans the backend accepts.
 *
 * One entry today — the Frappe `Loan Application.repayment_method` field also
 * offers "Repay Over Number of Periods", but the payroll side of this tenant
 * only reconciles a fixed monthly deduction, so offering the other would produce
 * applications nobody can process. Kept as a list rather than inlined so adding
 * the second is a one-line change that both UIs pick up.
 */
export const LOAN_REPAYMENT_METHODS = ['Repay Fixed Amount per Period'];

/**
 * "Add a loan product, a valid amount and a reason." — the checks `handleSubmit`
 * already runs, written as one sentence instead of a stack of red labels.
 *
 * Order matches the order the hook validates in, so the sentence reads the same
 * way the toasts would arrive. Returns null when there is nothing to say.
 */
export function describeMissingLoanFields({
  productMissing,
  amountMissing,
  amountInvalid,
  repaymentAmountMissing,
  repaymentAmountInvalid,
  repaymentMethodMissing,
  reasonMissing,
  file1Missing,
}) {
  const parts = [
    productMissing ? 'a loan product' : null,
    amountMissing ? 'an amount' : amountInvalid ? 'a valid amount' : null,
    repaymentAmountMissing
      ? 'a repayment amount'
      : repaymentAmountInvalid
        ? 'a valid repayment amount'
        : null,
    repaymentMethodMissing ? 'a repayment method' : null,
    reasonMissing ? 'a reason' : null,
    file1Missing ? 'Attachment 1' : null,
  ].filter(Boolean);

  if (!parts.length) return null;

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `Add ${list}.`;
}

/* -------------------------------------------------------------------------
 * Submitted applications
 * ---------------------------------------------------------------------- */

/**
 * A loan's status, described by the shared record describer.
 *
 * Kept as a named export because the loan screens and tests speak in loan terms;
 * the mapping itself is shared with Leave and Attendance Request so a pill means
 * the same thing in all three histories.
 */
export const describeLoanStatus = describeRecordStatus;

/**
 * One sentence per card, so a screen reader announces a loan as a single item
 * rather than six loose fragments. Mirrors `describeClaimForA11y`.
 *
 * The date and amount formatters are the expense-claim ones deliberately: a
 * figure and a date must read identically in both histories, and there is only
 * one of each in the app.
 */
export function describeLoanForA11y(loan) {
  const parts = [
    loan?.loan_product || 'Loan application',
    formatExpenseAmount(loan?.loan_amount),
    formatExpenseDate(loan?.posting_date),
    describeLoanStatus(loan?.status).label,
  ];

  return `${parts.join(', ')}.`;
}

import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  renderHook,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    Ionicons: stub,
    MaterialCommunityIcons: stub,
    AntDesign: stub,
    Octicons: stub,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockNavigation = { setOptions: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

// The screen must not reach a real endpoint. The service also pulls in
// apiClient → expo-location, which this jest config does not transform.
jest.mock('../services/api/loanApplication.service', () => ({
  getLoanProducts: jest.fn(),
  LoanApplicationRequest: jest.fn(),
  getLoanApplications: jest.fn(),
}));

// The history query is gated on the employee code, exactly as Expense Claims is.
jest.mock('react-redux', () => ({
  useSelector: () => 'EMP-001',
}));

// Dereferenced at render time, so the const is initialised by then.
const mockPickers = {
  pickFromCamera: jest.fn(),
  pickFromGallery: jest.fn(),
  pickDocument: jest.fn(),
};
jest.mock('../hooks/useAttachmentPicker', () => ({
  useAttachmentPicker: () => mockPickers,
}));

/* eslint-disable import/first */
import LoanApplication from '../screens/LoanApplication';
import useLoanApplication from '../hooks/useLoanApplication';
import UploadField from '../components/common/UploadField';
import {
  describeLoanStatus,
  describeMissingLoanFields,
  loanProductIcon,
} from '../utils/loanApplication';
import {
  getLoanApplications,
  getLoanProducts,
  LoanApplicationRequest,
} from '../services/api/loanApplication.service';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

const PRODUCTS = [{ product_name: 'Car Loan' }, { product_name: 'Personal' }];

const REPAYMENT_METHOD = 'Repay Fixed Amount per Period';

/** Six, so a PAGE_SIZE of five leaves exactly one behind "Load more". */
const LOANS = Array.from({ length: 6 }, (_, i) => ({
  name: `LA-000${i + 1}`,
  loan_product: 'Car Loan',
  loan_amount: 5000 + i,
  repayment_amount: 500,
  repayment_method: REPAYMENT_METHOD,
  reason: 'New car',
  status: 'Open',
  posting_date: `2026-08-0${i + 1}`,
}));

const FILE = {
  uri: 'file:///tmp/payslip.pdf',
  name: 'payslip.pdf',
  type: 'application/pdf',
};

/**
 * Tests run under jest-expo as iOS, so `showToast` takes the
 * `Alert.alert('Notice', …)` branch. On Android the identical string goes to
 * ToastAndroid — the strings, not the transport, are what must not drift.
 */
const toast = message => ['Notice', message];

/** The screen mounts a react-query mutation, so it needs a client. */
function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(<LoanApplication />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function renderLoanHook() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return renderHook(() => useLoanApplication(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  mockScheme = 'light';
  jest.clearAllMocks();
  getLoanProducts.mockResolvedValue(PRODUCTS);
  getLoanApplications.mockResolvedValue({ message: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Alert.alert.mockRestore();
});

/* =====================================================================
 * Presentation
 * ================================================================== */

describe('modern Loan Application screen', () => {
  it('introduces the screen in two lines above the form', async () => {
    const { getByText } = renderScreen();

    expect(getByText('Loan request')).toBeTruthy();
    expect(
      getByText(
        "Pick a product, enter the amount you need and say what it's for.",
      ),
    ).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('groups the form into a details card and an attachments card', async () => {
    const { getByText } = renderScreen();

    expect(getByText('Loan details')).toBeTruthy();
    expect(getByText('Select the product and enter your request')).toBeTruthy();
    expect(getByText('Attachments')).toBeTruthy();
    expect(getByText('Attachment 1 is required')).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('offers the five inputs the payload is built from', async () => {
    const { getByLabelText, getByText } = renderScreen();

    expect(getByText('Loan product *')).toBeTruthy();
    expect(getByLabelText('Loan amount')).toBeTruthy();
    expect(getByLabelText('Repayment amount')).toBeTruthy();
    expect(getByText('Repayment method *')).toBeTruthy();
    expect(getByLabelText('Reason')).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('says the repayment amount is per month, not the loan total', async () => {
    const { getByText } = renderScreen();

    expect(getByText('Repayment amount (per month) *')).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('keeps the repayment amount right-aligned and numeric too', async () => {
    const { getByLabelText } = renderScreen();

    const input = getByLabelText('Repayment amount');
    expect(input.props.keyboardType).toBe('numeric');
    expect(flatten(input.props.style).textAlign).toBe('right');

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('keeps the amount right-aligned and on the numeric keyboard', async () => {
    const { getByLabelText } = renderScreen();

    const input = getByLabelText('Loan amount');
    expect(input.props.keyboardType).toBe('numeric');
    expect(flatten(input.props.style).textAlign).toBe('right');

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('starts the reason box at four lines', async () => {
    const { getByLabelText } = renderScreen();

    const input = getByLabelText('Reason');
    expect(input.props.multiline).toBe(true);
    // 64 is the three-line floor; one more line of body type on top.
    expect(flatten(input.props.style).minHeight).toBe(85);

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('shows two independent upload slots, the first marked required', async () => {
    const { getByLabelText, getByText, getAllByText } = renderScreen();

    expect(getByText('Attachment 1')).toBeTruthy();
    expect(getByText('Attachment 2')).toBeTruthy();
    expect(getAllByText('Upload supporting document')).toHaveLength(2);
    expect(
      getByLabelText('Attachment 1. Upload supporting document. Required.'),
    ).toBeTruthy();
    expect(
      getByLabelText('Attachment 2. Upload supporting document. Optional.'),
    ).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('offers the primary action and says what happens next', async () => {
    const { getByLabelText, getByText } = renderScreen();

    const button = getByLabelText('Submit loan application');
    expect(button).toBeTruthy();
    expect(flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(getByText('What happens next')).toBeTruthy();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('uses the shared modern header, so the title and back button match', async () => {
    renderScreen();

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Loan Application');
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe('function');

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });
});

/* =====================================================================
 * Loan products — loaded exactly as before, presented in a sheet
 * ================================================================== */

describe('loan product selection', () => {
  it('fetches the product list once on mount', async () => {
    renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalledTimes(1));
  });

  it('lists what the server returned and stores the raw product name', async () => {
    const { getByLabelText } = renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fireEvent.press(getByLabelText('Loan product *: Select loan product'));
    fireEvent.press(getByLabelText('Car Loan'));

    // The picked string is what the wheel would have produced, unchanged — in
    // the field and echoed in the summary.
    expect(getByLabelText('Loan product *: Car Loan')).toBeTruthy();
    expect(getByLabelText(/^Summary\. Car Loan/)).toBeTruthy();
  });

  it('toasts the classic message when the list cannot be loaded', async () => {
    getLoanProducts.mockRejectedValue(new Error('offline'));

    renderScreen();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        ...toast('Unable to load loan products.'),
      ),
    );
  });

  it('says so when the tenant has configured no products', async () => {
    getLoanProducts.mockResolvedValue([]);

    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fireEvent.press(getByLabelText('Loan product *: Select loan product'));

    expect(getByText('No loan products')).toBeTruthy();
  });
});

/* =====================================================================
 * Summary — derived from state the screen already has
 * ================================================================== */

describe('application summary', () => {
  it('stays hidden until there is something to show', async () => {
    const { queryByText } = renderScreen();

    expect(queryByText('Loan product')).toBeNull();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });

  it('echoes the product, the grouped amount and the attachment count', async () => {
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fireEvent.press(getByLabelText('Loan product *: Select loan product'));
    fireEvent.press(getByLabelText('Personal'));
    fireEvent.changeText(getByLabelText('Loan amount'), '10000');

    expect(getByText('Requested')).toBeTruthy();
    // No currency symbol: the tenant's currency is unknown to this app.
    expect(getByText('10,000.00')).toBeTruthy();
    expect(getByText('No documents attached')).toBeTruthy();
  });
});

/* =====================================================================
 * Validation and submission — must match the classic form exactly
 * ================================================================== */

describe('submitting from the modern screen', () => {
  it('runs the classic checks in the classic order', async () => {
    const { getByLabelText } = renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    const submit = () => fireEvent.press(getByLabelText('Submit loan application'));

    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please select loan product.'),
    );

    fireEvent.press(getByLabelText('Loan product *: Select loan product'));
    fireEvent.press(getByLabelText('Car Loan'));
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(...toast('Please enter amount.'));

    fireEvent.changeText(getByLabelText('Loan amount'), '0');
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please enter a valid amount.'),
    );

    fireEvent.changeText(getByLabelText('Loan amount'), '5000');
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please enter repayment amount.'),
    );

    fireEvent.changeText(getByLabelText('Repayment amount'), '0');
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please enter a valid repayment amount.'),
    );

    fireEvent.changeText(getByLabelText('Repayment amount'), '500');
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please select repayment method.'),
    );

    fireEvent.press(
      getByLabelText('Repayment method *: Select repayment method'),
    );
    fireEvent.press(getByLabelText(REPAYMENT_METHOD));
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please enter the reason.'),
    );

    fireEvent.changeText(getByLabelText('Reason'), 'School fees');
    submit();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      ...toast('Please upload File 1.'),
    );

    // Nothing reached the network while the form was incomplete.
    expect(LoanApplicationRequest).not.toHaveBeenCalled();
  });

  it('surfaces what is still missing inline after an attempt', async () => {
    const { getByLabelText, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    // Nothing is marked before the first press — the form is untouched.
    expect(queryByText('Finish the form first')).toBeNull();

    fireEvent.press(getByLabelText('Submit loan application'));

    expect(getByText('Finish the form first')).toBeTruthy();
    expect(
      getByText(
        'Add a loan product, an amount, a repayment amount, a repayment ' +
          'method, a reason and Attachment 1.',
      ),
    ).toBeTruthy();
  });

  it('stays pressable while incomplete, so validation still runs', async () => {
    const { getByLabelText } = renderScreen();

    expect(
      getByLabelText('Submit loan application').props.accessibilityState
        .disabled,
    ).toBe(false);

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
  });
});

/* =====================================================================
 * useLoanApplication — the lifted flow
 * ================================================================== */

describe('useLoanApplication', () => {
  const fill = result => {
    act(() => result.current.selectProduct('Car Loan'));
    act(() => result.current.setAmount('  7500 '));
    act(() => result.current.setRepaymentAmount(' 625 '));
    act(() => result.current.selectRepaymentMethod(REPAYMENT_METHOD));
    act(() => result.current.setReason('  New car  '));
  };

  const attachFile1 = async result => {
    jest.useFakeTimers();
    mockPickers.pickDocument.mockResolvedValue(FILE);

    act(() => result.current.pickFile1());
    act(() => result.current.handlePickDocument());
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    jest.useRealTimers();
  };

  it('sends the payload: trimmed strings and numeric amounts', async () => {
    LoanApplicationRequest.mockResolvedValue({ message: 'ok' });

    const { result } = renderLoanHook();
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fill(result);
    await attachFile1(result);

    await act(async () => {
      await result.current.handleSubmit();
    });

    // react-query calls `mutationFn(variables, context)`, so assert on the
    // variables rather than the whole argument list.
    expect(LoanApplicationRequest).toHaveBeenCalledTimes(1);
    expect(LoanApplicationRequest.mock.calls[0][0]).toEqual({
      product_name: 'Car Loan',
      amount: 7500,
      repayment_amount: 625,
      repayment_method: REPAYMENT_METHOD,
      reason: 'New car',
      file1: FILE,
      file2: null,
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Loan application submitted successfully.',
      expect.any(Array),
    );
  });

  it('clears the form when the success alert is acknowledged', async () => {
    LoanApplicationRequest.mockResolvedValue({ message: 'ok' });

    const { result } = renderLoanHook();
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fill(result);
    await attachFile1(result);
    await act(async () => {
      await result.current.handleSubmit();
    });

    // The reset is the Alert's OK handler, exactly as the classic screen wired
    // it — the form is still filled in until it is pressed.
    expect(result.current.productName).toBe('Car Loan');

    const [, , buttons] = Alert.alert.mock.calls.find(
      call => call[0] === 'Success',
    );
    await act(async () => buttons[0].onPress());

    expect(result.current.productName).toBe('');
    expect(result.current.amount).toBe('');
    expect(result.current.repaymentAmount).toBe('');
    expect(result.current.repaymentMethod).toBe('');
    expect(result.current.reason).toBe('');
    expect(result.current.file1).toBeNull();
    expect(result.current.file2).toBeNull();
  });

  it('raises both classic notices when the request fails', async () => {
    LoanApplicationRequest.mockRejectedValue(new Error('Server said no'));

    const { result } = renderLoanHook();
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    fill(result);
    await attachFile1(result);
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Server said no');
    expect(Alert.alert).toHaveBeenCalledWith(
      ...toast('Failed to submit loan application.'),
    );
  });

  it('routes a picked file to the slot it was opened for', async () => {
    jest.useFakeTimers();
    mockPickers.pickFromGallery.mockResolvedValue(FILE);

    const { result } = renderLoanHook();

    act(() => result.current.pickFile2());
    expect(result.current.isBottomSheetVisible).toBe(true);

    act(() => result.current.handlePickGallery());
    // Dismissed first: presenting a picker over a closing modal drops it.
    expect(result.current.isBottomSheetVisible).toBe(false);
    expect(mockPickers.pickFromGallery).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.file2).toEqual(FILE);
    expect(result.current.file1).toBeNull();
    expect(result.current.attachmentCount).toBe(1);

    jest.useRealTimers();
  });

  it('removes each attachment independently', async () => {
    jest.useFakeTimers();
    mockPickers.pickDocument.mockResolvedValue(FILE);

    const { result } = renderLoanHook();

    act(() => result.current.pickFile1());
    act(() => result.current.handlePickDocument());
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.file1).toEqual(FILE);

    act(() => result.current.removeFile1());
    expect(result.current.file1).toBeNull();

    jest.useRealTimers();
  });

  it('mirrors handleSubmit checks without gating anything', async () => {
    const { result } = renderLoanHook();
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    expect(result.current.productMissing).toBe(true);
    expect(result.current.amountMissing).toBe(true);
    expect(result.current.amountInvalid).toBe(false); // empty is "missing", not "invalid"

    act(() => result.current.setAmount('-5'));
    expect(result.current.amountInvalid).toBe(true);

    act(() => result.current.setAmount('abc'));
    expect(result.current.amountInvalid).toBe(true);

    act(() => result.current.setAmount('250'));
    expect(result.current.amountInvalid).toBe(false);

    // The repayment pair mirrors the amount pair exactly.
    expect(result.current.repaymentAmountMissing).toBe(true);
    expect(result.current.repaymentAmountInvalid).toBe(false);
    expect(result.current.repaymentMethodMissing).toBe(true);

    act(() => result.current.setRepaymentAmount('0'));
    expect(result.current.repaymentAmountInvalid).toBe(true);

    act(() => result.current.setRepaymentAmount('25'));
    expect(result.current.repaymentAmountInvalid).toBe(false);

    act(() => result.current.selectRepaymentMethod(REPAYMENT_METHOD));
    expect(result.current.repaymentMethodMissing).toBe(false);
  });

  /* ------------------------------------------------------------------
   * History
   * ---------------------------------------------------------------- */

  it('sorts submitted applications newest first', async () => {
    getLoanApplications.mockResolvedValue({ message: LOANS });

    const { result } = renderLoanHook();

    await waitFor(() =>
      expect(result.current.loanApplications).toHaveLength(6),
    );

    expect(result.current.loanApplications[0].posting_date).toBe('2026-08-06');
    expect(result.current.loanApplications[5].posting_date).toBe('2026-08-01');
  });

  it('reveals five at a time behind Load more', async () => {
    getLoanApplications.mockResolvedValue({ message: LOANS });

    const { result } = renderLoanHook();

    await waitFor(() => expect(result.current.visibleLoans).toHaveLength(5));
    expect(result.current.hasMoreLoans).toBe(true);

    act(() => result.current.showMoreLoans());

    expect(result.current.visibleLoans).toHaveLength(6);
    expect(result.current.hasMoreLoans).toBe(false);
  });

  it('surfaces a history failure instead of rendering an empty list', async () => {
    getLoanApplications.mockResolvedValue({ error: 'Session expired.' });

    const { result } = renderLoanHook();

    await waitFor(() => expect(result.current.isHistoryError).toBe(true));
    expect(result.current.historyError?.message).toBe('Session expired.');
  });

  it('refreshes the history before the success alert is raised', async () => {
    getLoanApplications.mockResolvedValue({ message: [] });
    LoanApplicationRequest.mockResolvedValue({ message: 'ok' });

    const { result } = renderLoanHook();
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
    await waitFor(() => expect(getLoanApplications).toHaveBeenCalledTimes(1));

    fill(result);
    await attachFile1(result);
    await act(async () => {
      await result.current.handleSubmit();
    });

    // Once on mount, once after the submission landed.
    expect(getLoanApplications).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Loan application submitted successfully.',
      expect.any(Array),
    );
  });

  it('does not ask for products in a shape that could crash the picker', async () => {
    // A tenant that wraps the list; the service unwraps, the hook guards.
    getLoanProducts.mockResolvedValue({ not: 'an array' });

    const { result } = renderLoanHook();

    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());
    expect(Array.isArray(result.current.loanProducts)).toBe(true);
  });
});

/* =====================================================================
 * Shared helpers
 * ================================================================== */

describe('loanProductIcon', () => {
  it('matches on a substring, since products are tenant-configured', () => {
    expect(loanProductIcon('Car Loan')).toBe('car-outline');
    expect(loanProductIcon('Housing Advance')).toBe('home-outline');
    expect(loanProductIcon('Education Loan')).toBe('school-outline');
    expect(loanProductIcon('Medical Support')).toBe('medkit-outline');
    expect(loanProductIcon('Personal')).toBe('person-outline');
  });

  it('falls back to a wallet rather than a wrong picture', () => {
    expect(loanProductIcon('test')).toBe('wallet-outline');
    expect(loanProductIcon(undefined)).toBe('wallet-outline');
  });
});

describe('describeMissingLoanFields', () => {
  it('lists nothing when the form is complete', () => {
    expect(describeMissingLoanFields({})).toBeNull();
  });

  it('names a single gap without a list', () => {
    expect(describeMissingLoanFields({ reasonMissing: true })).toBe(
      'Add a reason.',
    );
  });

  it('tells an empty amount apart from an unusable one', () => {
    expect(describeMissingLoanFields({ amountMissing: true })).toBe(
      'Add an amount.',
    );
    expect(describeMissingLoanFields({ amountInvalid: true })).toBe(
      'Add a valid amount.',
    );
  });

  it('tells an empty repayment amount apart from an unusable one', () => {
    expect(
      describeMissingLoanFields({ repaymentAmountMissing: true }),
    ).toBe('Add a repayment amount.');
    expect(
      describeMissingLoanFields({ repaymentAmountInvalid: true }),
    ).toBe('Add a valid repayment amount.');
  });

  it('names the repayment method gap', () => {
    expect(describeMissingLoanFields({ repaymentMethodMissing: true })).toBe(
      'Add a repayment method.',
    );
  });

  it('joins several gaps in submit order', () => {
    expect(
      describeMissingLoanFields({
        productMissing: true,
        amountInvalid: true,
        repaymentMethodMissing: true,
        file1Missing: true,
      }),
    ).toBe(
      'Add a loan product, a valid amount, a repayment method and Attachment 1.',
    );
  });
});

describe('describeLoanStatus', () => {
  it('gives a rejection its own tone rather than a neutral pill', () => {
    // The classic card painted everything that was not "Open" grey, so a
    // rejection looked like an ordinary state.
    expect(describeLoanStatus('Rejected')).toEqual({
      label: 'Rejected',
      tone: 'error',
      icon: 'close-circle',
    });
    expect(describeLoanStatus('Approved').tone).toBe('success');
    expect(describeLoanStatus('Open').tone).toBe('info');
  });

  it('keeps an unfamiliar status neutral, never red', () => {
    const described = describeLoanStatus('Escalated');
    expect(described.label).toBe('Escalated');
    expect(described.tone).toBe('neutral');
  });

  it('says Unknown for a missing status', () => {
    expect(describeLoanStatus(undefined).label).toBe('Unknown');
  });
});

/* =====================================================================
 * UploadField — the additions Loan Application needed
 * ================================================================== */

describe('UploadField label and requirement', () => {
  it('is unchanged for every existing caller', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <UploadField file={null} onPick={jest.fn()} onRemove={jest.fn()} />,
    );

    expect(
      getByLabelText('Upload supporting document. Optional.'),
    ).toBeTruthy();
    expect(getByText('Optional')).toBeTruthy();
    expect(queryByText('Required')).toBeNull();
  });

  it('draws the caption above the target when given one', () => {
    const { getByText } = render(
      <UploadField
        label="Attachment 1"
        file={null}
        onPick={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(getByText('Attachment 1')).toBeTruthy();
  });

  it('says Required when the form will not submit without it', () => {
    const { getByLabelText, getByText } = render(
      <UploadField
        label="Attachment 1"
        optional={false}
        file={null}
        onPick={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(getByText('Required')).toBeTruthy();
    expect(
      getByLabelText('Attachment 1. Upload supporting document. Required.'),
    ).toBeTruthy();
  });

  it('keeps the caption and the remove button once a file is attached', () => {
    const onRemove = jest.fn();
    const { getByLabelText, getByText } = render(
      <UploadField
        label="Attachment 2"
        file={FILE}
        onPick={jest.fn()}
        onRemove={onRemove}
      />,
    );

    expect(getByText('Attachment 2')).toBeTruthy();
    expect(getByText('payslip.pdf')).toBeTruthy();
    expect(
      getByLabelText('Attachment 2. Attached: payslip.pdf. Tap to replace.'),
    ).toBeTruthy();

    fireEvent.press(getByLabelText('Remove attachment'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern Loan Application in dark mode', () => {
  it('takes every colour from the palette', async () => {
    const light = renderScreen();
    expect(flatten(light.getByText('Loan request').props.style).color).toBe(
      COLORS.textPrimary,
    );
    await waitFor(() => expect(getLoanProducts).toHaveBeenCalled());

    mockScheme = 'dark';
    const dark = renderScreen();
    expect(flatten(dark.getByText('Loan request').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    expect(flatten(dark.getByText('Loan details').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
  });
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/* eslint-disable import/first */
import {
  describeClaimForA11y,
  describeExpenseStatus,
  expenseTypeIcon,
  formatExpenseAmount,
  formatExpenseDate,
  formatExpenseType,
  parseExpenseDate,
  resolveAttachments,
  toWireDate,
} from '../utils/expenseClaims';
import FormField from '../components/ExpenseClaim/FormField';
import ExpenseTypeSheet from '../components/ExpenseClaim/ExpenseTypeSheet';
import ExpenseHistoryCard from '../components/ExpenseClaim/ExpenseHistoryCard';
import PickerField from '../components/common/PickerField';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

// The components spread arrays into `style`; flattening is the simplest way to
// assert on the resolved result.
function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

/**
 * The bordered container around a <FormField>'s input.
 *
 * A TextInput is wrapped in host views by the renderer, so `.parent` is not
 * reliably the box that carries the border. Walk up to the nearest ancestor that
 * actually has one instead.
 */
function boxOf(input) {
  let node = input.parent;
  while (node) {
    const style = flatten(node.props?.style);
    if (style.borderWidth) return style;
    node = node.parent;
  }
  throw new Error('no bordered container found above the input');
}

/* =====================================================================
 * utils/expenseClaims — dates
 * ================================================================== */

describe('parseExpenseDate', () => {
  it('reads a bare YYYY-MM-DD as a local date, not UTC midnight', () => {
    const parsed = parseExpenseDate('2026-08-05');

    // The bug this guards: `new Date('2026-08-05')` is UTC midnight, which is
    // the 4th anywhere west of Greenwich.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(5);
  });

  it('accepts a full timestamp by reading only its date part', () => {
    const parsed = parseExpenseDate('2026-08-05 17:39:45');
    expect(parsed.getDate()).toBe(5);
  });

  it('passes a valid Date straight through', () => {
    const date = new Date(2026, 7, 5);
    expect(parseExpenseDate(date)).toBe(date);
  });

  it('returns null for anything unparseable rather than an Invalid Date', () => {
    // date-fns v2 throws on an Invalid Date, so the null is what keeps a bad
    // server value from taking the screen down.
    expect(parseExpenseDate('')).toBeNull();
    expect(parseExpenseDate(null)).toBeNull();
    expect(parseExpenseDate('not a date')).toBeNull();
    expect(parseExpenseDate(new Date('nope'))).toBeNull();
  });
});

describe('formatExpenseDate', () => {
  it('renders the same string Attendance History uses', () => {
    expect(formatExpenseDate('2026-08-05')).toBe('5 Aug 2026');
  });

  it('says so when there is no date, instead of throwing', () => {
    expect(formatExpenseDate(undefined)).toBe('No date');
  });
});

describe('toWireDate', () => {
  it('emits local YYYY-MM-DD, the format createExpenseClaim expects', () => {
    expect(toWireDate(new Date(2026, 7, 5))).toBe('2026-08-05');
  });
});

/* =====================================================================
 * utils/expenseClaims — amounts
 * ================================================================== */

describe('formatExpenseAmount', () => {
  it('groups thousands and pins two decimals', () => {
    expect(formatExpenseAmount(1250)).toBe('1,250.00');
    expect(formatExpenseAmount(1234567.5)).toBe('1,234,567.50');
    expect(formatExpenseAmount(9.999)).toBe('10.00');
  });

  it('accepts the numeric strings the backend sometimes returns', () => {
    expect(formatExpenseAmount('1250.5')).toBe('1,250.50');
  });

  it('keeps the sign outside the grouping', () => {
    expect(formatExpenseAmount(-1250)).toBe('-1,250.00');
  });

  it('degrades to a dash rather than printing NaN', () => {
    expect(formatExpenseAmount(null)).toBe('—');
    expect(formatExpenseAmount('abc')).toBe('—');
  });
});

/* =====================================================================
 * utils/expenseClaims — status
 * ================================================================== */

describe('describeExpenseStatus', () => {
  it('maps the three statuses the classic card coloured', () => {
    expect(describeExpenseStatus('Approved').tone).toBe('success');
    expect(describeExpenseStatus('Rejected').tone).toBe('error');
    expect(describeExpenseStatus('Pending').tone).toBe('warning');
  });

  it('maps the rest of the doctype rather than greying them all out', () => {
    expect(describeExpenseStatus('Paid').tone).toBe('success');
    expect(describeExpenseStatus('Submitted').tone).toBe('info');
    expect(describeExpenseStatus('Draft').tone).toBe('neutral');
    expect(describeExpenseStatus('Cancelled').tone).toBe('error');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(describeExpenseStatus('  approved ').label).toBe('Approved');
  });

  it('keeps an unknown status neutral — never red', () => {
    const unknown = describeExpenseStatus('Escalated');
    expect(unknown.tone).toBe('neutral');
    expect(unknown.label).toBe('Escalated');
  });
});

/* =====================================================================
 * utils/expenseClaims — types
 * ================================================================== */

describe('expenseTypeIcon', () => {
  it('matches on a substring, since types are tenant-configured', () => {
    expect(expenseTypeIcon('Travel')).toBe('airplane-outline');
    expect(expenseTypeIcon('Local Travel Expenses')).toBe('airplane-outline');
    expect(expenseTypeIcon('Medical')).toBe('medkit-outline');
    expect(expenseTypeIcon('Calls')).toBe('call-outline');
  });

  it('falls back to a neutral tag rather than a wrong picture', () => {
    expect(expenseTypeIcon('Sundry')).toBe('pricetag-outline');
    expect(expenseTypeIcon(undefined)).toBe('pricetag-outline');
  });
});

describe('formatExpenseType', () => {
  it('capitalises the way the classic card did inline', () => {
    expect(formatExpenseType('travel')).toBe('Travel');
  });

  it('has a label for a claim with no type', () => {
    expect(formatExpenseType('')).toBe('Expense');
  });
});

/* =====================================================================
 * utils/expenseClaims — attachments
 * ================================================================== */

describe('resolveAttachments', () => {
  it('handles the three shapes file_url arrives in', () => {
    expect(resolveAttachments(null)).toEqual([]);
    expect(resolveAttachments('/files/a.pdf', 'https://x.com')).toHaveLength(1);
    expect(
      resolveAttachments(['/files/a.pdf', '/files/b.pdf'], 'https://x.com'),
    ).toHaveLength(2);
  });

  it('joins a relative Frappe path to the tenant base URL', () => {
    const [file] = resolveAttachments('/files/receipt.pdf', 'https://demo.erp');
    expect(file.url).toBe('https://demo.erp/files/receipt.pdf');
    expect(file.name).toBe('receipt.pdf');
  });

  it('leaves an absolute URL alone', () => {
    const [file] = resolveAttachments('https://cdn.io/r.pdf', 'https://demo.erp');
    expect(file.url).toBe('https://cdn.io/r.pdf');
  });

  it('detects images by extension and by object type', () => {
    const [byExt] = resolveAttachments('/files/r.JPG', 'https://x');
    const [byType] = resolveAttachments(
      [{ url: 'https://x/r', type: 'image/png', name: 'r' }],
      '',
    );
    expect(byExt.isImage).toBe(true);
    expect(byType.isImage).toBe(true);
    expect(resolveAttachments('/files/r.pdf', 'https://x')[0].isImage).toBe(false);
  });

  it('drops an entry with no resolvable URL instead of rendering a dead link', () => {
    expect(resolveAttachments([{ name: 'orphan' }, '/files/a.pdf'], '')).toHaveLength(
      1,
    );
  });

  it('gives every entry a distinct key, even for a repeated file', () => {
    const files = resolveAttachments(['/f/a.pdf', '/f/a.pdf'], '');
    expect(files[0].key).not.toBe(files[1].key);
  });
});

describe('describeClaimForA11y', () => {
  it('announces a claim as one sentence, not six fragments', () => {
    const label = describeClaimForA11y(
      {
        expense_type: 'travel',
        amount: 1250,
        expense_date: '2026-08-05',
        status: 'Approved',
      },
      1,
    );

    expect(label).toBe('Travel, 1,250.00, 5 Aug 2026, Approved, 1 attachment');
  });

  it('reports an absent receipt, which the card does not render a row for', () => {
    const label = describeClaimForA11y({ expense_type: 'Calls', amount: 20 }, 0);
    expect(label).toContain('No attachment');
  });
});

/* =====================================================================
 * FormField
 * ================================================================== */

describe('FormField', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('labels the input so it is reachable without reading the layout', () => {
    const { getByLabelText, getByText } = render(
      <FormField label="Amount" value="12" onChangeText={jest.fn()} />,
    );

    expect(getByText('Amount')).toBeTruthy();
    expect(getByLabelText('Amount')).toBeTruthy();
  });

  it('reports typing straight through to the shared hook', () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <FormField label="Amount" value="" onChangeText={onChangeText} />,
    );

    fireEvent.changeText(getByLabelText('Amount'), '250');
    expect(onChangeText).toHaveBeenCalledWith('250');
  });

  it('marks an optional field on the label rather than in the placeholder', () => {
    const { getByText } = render(
      <FormField label="Description" value="" onChangeText={jest.fn()} optional />,
    );

    expect(getByText('Optional')).toBeTruthy();
  });

  it('matches PickerField: same 56pt row, radius and recessed fill', () => {
    const field = render(
      <FormField label="Amount" value="" onChangeText={jest.fn()} />,
    );
    const picker = render(
      <PickerField label="Date" value="5 Aug 2026" icon="calendar-outline" onPress={jest.fn()} />,
    );

    const fieldBox = boxOf(field.getByLabelText('Amount'));
    const pickerBox = flatten(
      picker.getByLabelText('Date: 5 Aug 2026').props.style,
    );

    expect(fieldBox.minHeight).toBe(pickerBox.minHeight);
    expect(fieldBox.borderRadius).toBe(pickerBox.borderRadius);
    expect(fieldBox.backgroundColor).toBe(pickerBox.backgroundColor);
  });

  it('reads focus as focus and an invalid value as an error — different borders', () => {
    const { getByLabelText } = render(
      <FormField label="Amount" value="abc" onChangeText={jest.fn()} invalid />,
    );

    const box = boxOf(getByLabelText('Amount'));
    expect(box.borderColor).toBe(COLORS.errorBorder);
    expect(box.borderColor).not.toBe(COLORS.textPrimary);
  });

  it('lifts the surface and the border on focus, without reflowing', () => {
    const { getByLabelText } = render(
      <FormField label="Amount" value="" onChangeText={jest.fn()} />,
    );

    const input = getByLabelText('Amount');
    const resting = boxOf(input);

    fireEvent(input, 'focus');
    const focused = boxOf(input);

    expect(resting.backgroundColor).toBe(COLORS.surfaceSecondary);
    expect(focused.backgroundColor).toBe(COLORS.cardBackground);
    expect(focused.borderColor).toBe(COLORS.textPrimary);
    // A border that thickened on focus would shift every neighbour by a pixel.
    expect(focused.borderWidth).toBe(resting.borderWidth);
  });

  it('grows for a description and pins its text to the top', () => {
    const { getByLabelText } = render(
      <FormField label="Description" value="" onChangeText={jest.fn()} multiline />,
    );

    const box = boxOf(getByLabelText('Description'));
    const input = flatten(getByLabelText('Description').props.style);

    expect(box.minHeight).toBeGreaterThan(56);
    expect(box.alignItems).toBe('flex-start');
    expect(input.textAlignVertical).toBe('top');
  });

  it('renders an amount tabular, so a column of figures lines up', () => {
    const { getByLabelText } = render(
      <FormField label="Amount" value="1250" onChangeText={jest.fn()} align="right" />,
    );

    const input = flatten(getByLabelText('Amount').props.style);
    expect(input.textAlign).toBe('right');
    expect(input.fontVariant).toEqual(['tabular-nums']);
  });

  it('takes its colours from the dark palette when the theme is dark', () => {
    mockScheme = 'dark';
    const { getByLabelText } = render(
      <FormField label="Amount" value="" onChangeText={jest.fn()} />,
    );

    const box = boxOf(getByLabelText('Amount'));
    expect(box.backgroundColor).toBe(DARK_COLORS.surfaceSecondary);
  });
});

/* =====================================================================
 * PickerField placeholder — the addition Expense Claims needed
 * ================================================================== */

describe('PickerField placeholder', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows the placeholder muted when the field has no value yet', () => {
    const { getByText } = render(
      <PickerField
        label="Expense date"
        value=""
        placeholder="Select a date"
        icon="calendar-outline"
        onPress={jest.fn()}
      />,
    );

    const text = getByText('Select a date');
    expect(flatten(text.props.style).color).toBe(COLORS.textMuted);
  });

  it('shows a real value in the primary colour, so set and unset differ', () => {
    const { getByText } = render(
      <PickerField
        label="Expense date"
        value="5 Aug 2026"
        placeholder="Select a date"
        icon="calendar-outline"
        onPress={jest.fn()}
      />,
    );

    expect(flatten(getByText('5 Aug 2026').props.style).color).toBe(
      COLORS.textPrimary,
    );
  });

  it('announces the placeholder, so an empty field is not read as "undefined"', () => {
    const { getByLabelText } = render(
      <PickerField
        label="Expense type"
        value=""
        placeholder="Choose a type"
        icon="pricetag-outline"
        onPress={jest.fn()}
      />,
    );

    expect(getByLabelText('Expense type: Choose a type')).toBeTruthy();
  });
});

/* =====================================================================
 * ExpenseTypeSheet
 * ================================================================== */

describe('ExpenseTypeSheet', () => {
  const types = ['Travel', 'Medical', 'Calls'];

  beforeEach(() => {
    mockScheme = 'light';
  });

  it('lists every type the server returned', () => {
    const { getByText } = render(
      <ExpenseTypeSheet visible types={types} onSelect={jest.fn()} onClose={jest.fn()} />,
    );

    types.forEach(type => expect(getByText(type)).toBeTruthy());
  });

  it('hands back the raw server string, so the payload is unchanged', () => {
    const onSelect = jest.fn();
    const { getByLabelText } = render(
      <ExpenseTypeSheet visible types={types} onSelect={onSelect} onClose={jest.fn()} />,
    );

    fireEvent.press(getByLabelText('Travel'));
    expect(onSelect).toHaveBeenCalledWith('Travel');
  });

  it('marks the current choice for a screen reader, not just with a tick', () => {
    const { getByLabelText } = render(
      <ExpenseTypeSheet
        visible
        types={types}
        selected="Medical"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(getByLabelText('Medical').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Travel').props.accessibilityState.selected).toBe(false);
  });

  it('says so when the tenant has configured no types', () => {
    const { getByText } = render(
      <ExpenseTypeSheet visible types={[]} onSelect={jest.fn()} onClose={jest.fn()} />,
    );

    expect(getByText('No expense types')).toBeTruthy();
  });

  it('closes from the backdrop as well as the button', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <ExpenseTypeSheet visible types={types} onSelect={jest.fn()} onClose={onClose} />,
    );

    // The backdrop's label comes from <BottomSheet>, which names the sheet it
    // is dismissing rather than saying a bare "Close" twice on one screen.
    fireEvent.press(getByLabelText('Close Expense type'));
    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/* =====================================================================
 * ExpenseHistoryCard
 * ================================================================== */

describe('ExpenseHistoryCard', () => {
  const claim = {
    name: 'HR-EXP-2026-00042',
    expense_type: 'travel',
    expense_date: '2026-08-05',
    amount: 1250,
    description: 'Airport transfer',
    status: 'Approved',
  };

  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows type, date, amount, description and status', () => {
    const { getByText } = render(<ExpenseHistoryCard claim={claim} />);

    expect(getByText('Travel')).toBeTruthy();
    expect(getByText('5 Aug 2026')).toBeTruthy();
    expect(getByText('1,250.00')).toBeTruthy();
    expect(getByText('Airport transfer')).toBeTruthy();
    expect(getByText('Approved')).toBeTruthy();
  });

  it('makes the amount the largest thing on the card', () => {
    const { getByText } = render(<ExpenseHistoryCard claim={claim} />);

    const amount = flatten(getByText('1,250.00').props.style);
    const type = flatten(getByText('Travel').props.style);
    const date = flatten(getByText('5 Aug 2026').props.style);

    expect(amount.fontSize).toBeGreaterThan(type.fontSize);
    expect(type.fontSize).toBeGreaterThan(date.fontSize);
    expect(amount.fontVariant).toEqual(['tabular-nums']);
  });

  it('announces the whole card as one sentence', () => {
    const { getByLabelText } = render(<ExpenseHistoryCard claim={claim} />);

    expect(
      getByLabelText('Travel, 1,250.00, 5 Aug 2026, Approved, No attachment'),
    ).toBeTruthy();
  });

  it('spends no height on a receipt row when there is no receipt', () => {
    const { queryByText } = render(<ExpenseHistoryCard claim={claim} />);
    expect(queryByText('No attachment')).toBeNull();
  });

  it('renders a receipt as an openable row resolved against the tenant URL', () => {
    const { getByLabelText } = render(
      <ExpenseHistoryCard
        claim={{ ...claim, file_url: '/files/receipt.pdf' }}
        baseUrl="https://demo.erp"
      />,
    );

    expect(getByLabelText('Open receipt.pdf')).toBeTruthy();
  });

  it('opens the receipt with the same Linking call the classic card made', () => {
    const { Linking } = require('react-native');
    const spy = jest.spyOn(Linking, 'openURL').mockImplementation(() => {});

    const { getByLabelText } = render(
      <ExpenseHistoryCard
        claim={{ ...claim, file_url: '/files/receipt.pdf' }}
        baseUrl="https://demo.erp"
      />,
    );

    fireEvent.press(getByLabelText('Open receipt.pdf'));
    expect(spy).toHaveBeenCalledWith('https://demo.erp/files/receipt.pdf');
    spy.mockRestore();
  });

  it('colours the status from the shared tone, not from a local switch', () => {
    const rejected = render(
      <ExpenseHistoryCard claim={{ ...claim, status: 'Rejected' }} />,
    );

    expect(flatten(rejected.getByText('Rejected').props.style).color).toBe(
      COLORS.errorText,
    );
  });

  it('does not style an unfamiliar status as a rejection', () => {
    const { getByText } = render(
      <ExpenseHistoryCard claim={{ ...claim, status: 'Escalated' }} />,
    );

    const style = flatten(getByText('Escalated').props.style);
    expect(style.color).not.toBe(COLORS.errorText);
    expect(style.color).toBe(COLORS.neutralText);
  });

  it('survives a claim with nothing but an id', () => {
    const { getByText } = render(<ExpenseHistoryCard claim={{ name: 'X' }} />);

    expect(getByText('Expense')).toBeTruthy();
    expect(getByText('No date')).toBeTruthy();
    expect(getByText('—')).toBeTruthy();
  });

  it('takes its surface from the dark palette when the theme is dark', () => {
    mockScheme = 'dark';
    const { getByText } = render(<ExpenseHistoryCard claim={claim} />);

    expect(flatten(getByText('Travel').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
  });
});

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
  return {
    Ionicons: stub,
    MaterialCommunityIcons: stub,
    AntDesign: stub,
    Octicons: stub,
    Entypo: stub,
  };
});

// The classic component imports the deep path rather than the barrel, so it
// needs its own mock — without it the untransformed ESM module fails the suite.
jest.mock('@expo/vector-icons/Entypo', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text>{`icon:${name}`}</Text>,
  };
});

let mockNewHomeEnabled = true;
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({
    enabled: mockNewHomeEnabled,
    hydrated: true,
    setEnabled: jest.fn(),
  }),
}));

const mockSetOptions = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ setOptions: mockSetOptions, goBack: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/* eslint-disable import/first */
import {
  buildDetailModel,
  describeDocumentStatus,
  describeRemaining,
  documentSubtitle,
  fieldIcon,
  formatFieldLabel,
  formatFieldValue,
  isExpiryField,
  isRemainingField,
  isStatusField,
  parseRemainingDays,
  resolveValidityWindow,
} from '../utils/shortcutDetails';
import ShortcutDetails from '../components/ShortcutDetails';
import ShortcutDetailsModern from '../components/ShortcutDetails/ShortcutDetailsModern';
import DetailRow from '../components/ShortcutDetails/DetailRow';
import ValidityBar from '../components/ShortcutDetails/ValidityBar';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

function stylesIn(node) {
  return node
    .findAll(child => typeof child.type === 'string' && !!child.props?.style, {
      deep: true,
    })
    .map(child => flatten(child.props.style));
}

/** A realistic Health Card payload — arbitrary keys, exactly as a tenant sends. */
const HEALTH_CARD = {
  card_number: '389290',
  expiry_date: '2025-12-25',
  remaining_days: '100 Days',
  status: 'Approved',
};

/* =====================================================================
 * Labels
 * ================================================================== */

describe('formatFieldLabel', () => {
  it('matches the classic transform exactly, so rows are titled the same', () => {
    // The classic component's inline formatter, reproduced.
    const classic = key =>
      key
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

    [
      'card_number',
      'expiry_date',
      'remaining_days',
      'status',
      'residence_permit_no',
      'already Spaced',
    ].forEach(key => {
      expect(formatFieldLabel(key)).toBe(classic(key));
    });
  });

  it('survives a non-string key', () => {
    expect(formatFieldLabel(42)).toBe('42');
    expect(formatFieldLabel()).toBe('');
  });
});

/* =====================================================================
 * Field classification
 * ================================================================== */

describe('field classification', () => {
  it('recognises the status field under the names tenants actually use', () => {
    ['status', 'card_status', 'approval_status', 'state'].forEach(key =>
      expect(isStatusField(key)).toBe(true),
    );
    expect(isStatusField('card_number')).toBe(false);
  });

  it('recognises a countdown field', () => {
    ['remaining_days', 'balance_days', 'days_left', 'remaining'].forEach(key =>
      expect(isRemainingField(key)).toBe(true),
    );
    expect(isRemainingField('issue_date')).toBe(false);
  });

  it('recognises an expiry field', () => {
    ['expiry_date', 'expiry', 'valid_till', 'valid_until', 'end_date'].forEach(
      key => expect(isExpiryField(key)).toBe(true),
    );
    expect(isExpiryField('issue_date')).toBe(false);
  });
});

describe('fieldIcon', () => {
  it('picks a glyph that fits the field', () => {
    expect(fieldIcon('expiry_date')).toBe('calendar-outline');
    expect(fieldIcon('card_number')).toBe('card-outline');
    expect(fieldIcon('remaining_days')).toBe('hourglass-outline');
    expect(fieldIcon('nationality')).toBe('flag-outline');
    expect(fieldIcon('employee_name')).toBe('person-outline');
  });

  it('lets the specific rule win over the general one', () => {
    // "issue_date" contains "date"; the issue rule has to be reached first.
    expect(fieldIcon('issue_date')).toBe('calendar-number-outline');
    // "passport_number" contains "number"; the passport rule sits above it.
    expect(fieldIcon('passport_number')).toBe('airplane-outline');
  });

  it('falls back to a neutral glyph rather than a wrong one', () => {
    expect(fieldIcon('some_tenant_field')).toBe('information-circle-outline');
    expect(fieldIcon(undefined)).toBe('information-circle-outline');
  });
});

/* =====================================================================
 * Status
 * ================================================================== */

describe('describeDocumentStatus', () => {
  it('tones the states the brief names', () => {
    expect(describeDocumentStatus('Approved').tone).toBe('success');
    expect(describeDocumentStatus('Confirmed').tone).toBe('success');
    expect(describeDocumentStatus('Expired').tone).toBe('error');
    expect(describeDocumentStatus('Pending').tone).toBe('warning');
    expect(describeDocumentStatus('Rejected').tone).toBe('error');
  });

  it('keeps the tenant’s own wording rather than substituting a word', () => {
    expect(describeDocumentStatus('renewed').label).toBe('Renewed');
    expect(describeDocumentStatus('Under Review').label).toBe('Under Review');
  });

  it('reads "approval pending" as pending, not as approved', () => {
    // Both words are present; the pending rule is tested first for this reason.
    expect(describeDocumentStatus('approval pending').tone).toBe('warning');
  });

  it('never reds an unfamiliar status', () => {
    const unknown = describeDocumentStatus('Escalated');
    expect(unknown.tone).toBe('neutral');
    expect(unknown.label).toBe('Escalated');
  });

  it('has something to say about a missing status', () => {
    expect(describeDocumentStatus('').label).toBe('Not available');
    expect(describeDocumentStatus(null).tone).toBe('neutral');
  });
});

/* =====================================================================
 * Remaining days
 * ================================================================== */

describe('parseRemainingDays', () => {
  it('reads the number out of the shapes the server sends', () => {
    expect(parseRemainingDays(100)).toBe(100);
    expect(parseRemainingDays('100')).toBe(100);
    expect(parseRemainingDays('100 Days')).toBe(100);
    expect(parseRemainingDays(' -5 days')).toBe(-5);
  });

  it('refuses a value with no leading number', () => {
    expect(parseRemainingDays('N/A')).toBeNull();
    expect(parseRemainingDays(null)).toBeNull();
    expect(parseRemainingDays({})).toBeNull();
  });
});

describe('describeRemaining', () => {
  it('is calm when the document has plenty of time left', () => {
    expect(describeRemaining('100 Days')).toMatchObject({
      days: 100,
      tone: 'success',
      caption: 'Valid',
    });
  });

  it('warns inside the renewal window', () => {
    expect(describeRemaining('30').tone).toBe('warning');
    expect(describeRemaining('1').tone).toBe('warning');
    expect(describeRemaining('31').tone).toBe('success');
  });

  it('reports an elapsed document as expired', () => {
    expect(describeRemaining('0')).toMatchObject({ tone: 'error', caption: 'Expired' });
    expect(describeRemaining('-12').tone).toBe('error');
  });

  it('stays neutral when the value is not a number at all', () => {
    expect(describeRemaining('N/A')).toMatchObject({ days: null, tone: 'neutral' });
  });
});

/* =====================================================================
 * Values
 * ================================================================== */

describe('formatFieldValue', () => {
  it('renders an em dash instead of blank space', () => {
    expect(formatFieldValue('')).toBe('—');
    expect(formatFieldValue('   ')).toBe('—');
    expect(formatFieldValue(null)).toBe('—');
    expect(formatFieldValue(undefined)).toBe('—');
  });

  it('renders an ISO date the way the rest of the app does', () => {
    expect(formatFieldValue('2025-12-25')).toBe('25 Dec 2025');
    expect(formatFieldValue('2025-12-25 10:30:00')).toBe('25 Dec 2025');
  });

  it('reads an ISO date locally, so it cannot shift a day', () => {
    // `new Date('2025-01-01')` is UTC midnight — 31 Dec west of Greenwich.
    expect(formatFieldValue('2025-01-01')).toBe('1 Jan 2025');
  });

  it('leaves every other value exactly as the classic screen printed it', () => {
    expect(formatFieldValue('389290')).toBe('389290');
    expect(formatFieldValue(389290)).toBe('389290');
    expect(formatFieldValue(true)).toBe('true');
    expect(formatFieldValue('25/12/2025')).toBe('25/12/2025');
    expect(formatFieldValue('Qatar')).toBe('Qatar');
  });
});

/* =====================================================================
 * Screen model
 * ================================================================== */

describe('buildDetailModel', () => {
  it('promotes status and countdown out of the table', () => {
    const model = buildDetailModel(HEALTH_CARD);

    expect(model.status).toMatchObject({ key: 'status', value: 'Approved' });
    expect(model.remaining).toMatchObject({ key: 'remaining_days' });
    // …and does not also leave them in the rows, which would state each twice.
    expect(model.rows.map(r => r.key)).toEqual(['card_number', 'expiry_date']);
  });

  it('keeps the server’s field order for everything else', () => {
    const model = buildDetailModel({
      zeta: '1',
      alpha: '2',
      middle: '3',
    });

    expect(model.rows.map(r => r.key)).toEqual(['zeta', 'alpha', 'middle']);
  });

  it('drops exactly what the classic component dropped — null and undefined', () => {
    const model = buildDetailModel({
      a: null,
      b: undefined,
      c: '',
      d: 0,
      e: false,
    });

    // Blank, zero and false are real answers and still get a row; only the two
    // absent values are removed, which is the classic filter.
    expect(model.rows.map(r => r.key)).toEqual(['c', 'd', 'e']);
    expect(model.rows[0].value).toBe('—');
    expect(model.rows[1].value).toBe('0');
    expect(model.rows[2].value).toBe('false');
  });

  it('summarises the expiry in the subtitle when no countdown card will show it', () => {
    // No `remaining_days` here, so nothing else on the screen prints the expiry
    // and the subtitle is the place for it.
    expect(
      buildDetailModel({ card_number: '1', expiry_date: '2025-12-25' }, 'Passport')
        .subtitle,
    ).toBe('Valid until 25 Dec 2025');
  });

  it('names the document instead when the countdown card already prints the expiry', () => {
    // HEALTH_CARD has both expiry and remaining_days — saying "Valid until
    // 25 Dec 2025" in the hero as well would state it twice, inches apart.
    expect(buildDetailModel(HEALTH_CARD, 'Health Card').subtitle).toBe(
      'Health card information',
    );
  });

  it('always has a subtitle, even with no expiry at all', () => {
    expect(buildDetailModel({ card_number: '1' }, 'Labour Card').subtitle).toBe(
      'Labour card information',
    );
  });

  it('hands the expiry to the countdown card to render', () => {
    expect(buildDetailModel(HEALTH_CARD, 'Health Card').expiryValue).toBe(
      '25 Dec 2025',
    );
    expect(buildDetailModel({ card_number: '1' }, 'X').expiryValue).toBeNull();
  });

  it('promotes only the first status-like field, so a second is not swallowed', () => {
    const model = buildDetailModel({
      status: 'Approved',
      approval_status: 'Confirmed',
    });

    expect(model.status.key).toBe('status');
    expect(model.rows.map(r => r.key)).toEqual(['approval_status']);
  });

  it('copes with no data at all', () => {
    expect(buildDetailModel(null)).toMatchObject({
      status: null,
      remaining: null,
      rows: [],
      expiryValue: null,
      // Never blank, even with nothing to describe.
      subtitle: 'Document information',
    });
  });
});

/* =====================================================================
 * Subtitle fallback
 * ================================================================== */

describe('documentSubtitle', () => {
  it('names the document in sentence case', () => {
    expect(documentSubtitle('Health Card')).toBe('Health card information');
    expect(documentSubtitle('Residence Permit')).toBe(
      'Residence permit information',
    );
    expect(documentSubtitle('Passport')).toBe('Passport information');
    expect(documentSubtitle('Visa')).toBe('Visa information');
    expect(documentSubtitle('Labour Card')).toBe('Labour card information');
  });

  it('keeps the tenant’s own spelling rather than correcting it', () => {
    // The brief's example reads "Driving licence information"; the title the
    // tenant configured is "Driving License". Rewriting their spelling would be
    // editing tenant text, so the word they chose is the word that renders.
    expect(documentSubtitle('Driving License')).toBe(
      'Driving license information',
    );
    expect(documentSubtitle('Driving Licence')).toBe(
      'Driving licence information',
    );
  });

  it('handles a title in any case the server sends', () => {
    expect(documentSubtitle('RESIDENCE PERMIT')).toBe(
      'Residence permit information',
    );
    expect(documentSubtitle('  health card  ')).toBe('Health card information');
  });

  it('falls back to a generic line for an unknown or missing type', () => {
    expect(documentSubtitle('')).toBe('Document information');
    expect(documentSubtitle(null)).toBe('Document information');
    expect(documentSubtitle(undefined)).toBe('Document information');
  });

  it('works for a document type nobody anticipated', () => {
    expect(documentSubtitle('Gate Pass')).toBe('Gate pass information');
  });

  it('does not stutter when the title already ends in a noun like this', () => {
    expect(documentSubtitle('Health Information')).toBe('Health information');
    expect(documentSubtitle('Vehicle Details')).toBe('Vehicle details');
  });
});

/* =====================================================================
 * Validity window
 * ================================================================== */

describe('resolveValidityWindow', () => {
  it('measures the span between a real issue date and a real expiry date', () => {
    const window = resolveValidityWindow(
      { issue_date: '2025-01-01', expiry_date: '2025-12-27' },
      '180 Days',
    );

    expect(window.totalDays).toBe(360);
    expect(window.remainingDays).toBe(180);
    expect(window.fraction).toBeCloseTo(0.5, 5);
  });

  it('returns null without an issue date, rather than inventing a start', () => {
    // The countdown alone cannot imply a total — deriving one would fabricate
    // a date the server never sent.
    expect(
      resolveValidityWindow({ expiry_date: '2025-12-25' }, '100 Days'),
    ).toBeNull();
  });

  it('returns null when the dates are the wrong way round or equal', () => {
    expect(
      resolveValidityWindow(
        { issue_date: '2025-12-25', expiry_date: '2025-01-01' },
        '10',
      ),
    ).toBeNull();
    expect(
      resolveValidityWindow(
        { issue_date: '2025-01-01', expiry_date: '2025-01-01' },
        '10',
      ),
    ).toBeNull();
  });

  it('returns null when a date is not ISO — it never guesses a format', () => {
    expect(
      resolveValidityWindow(
        { issue_date: '01/01/2025', expiry_date: '25/12/2025' },
        '100',
      ),
    ).toBeNull();
  });

  it('returns null when the countdown itself is unreadable', () => {
    expect(
      resolveValidityWindow(
        { issue_date: '2025-01-01', expiry_date: '2025-12-25' },
        'N/A',
      ),
    ).toBeNull();
  });

  it('clamps rather than reporting more than a full bar or less than none', () => {
    const over = resolveValidityWindow(
      { issue_date: '2025-01-01', expiry_date: '2025-01-11' },
      '400 Days',
    );
    const under = resolveValidityWindow(
      { issue_date: '2025-01-01', expiry_date: '2025-01-11' },
      '-40 Days',
    );

    expect(over.fraction).toBe(1);
    expect(under.fraction).toBe(0);
  });
});

/* =====================================================================
 * ValidityBar
 * ================================================================== */

describe('ValidityBar', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('fills proportionally when the span was actually measured', () => {
    const { UNSAFE_root } = render(<ValidityBar tone="success" fraction={0.25} />);

    const fill = stylesIn(UNSAFE_root).find(style => style.width === '25%');
    expect(fill).toBeTruthy();
    expect(fill.backgroundColor).toBe(COLORS.successText);
  });

  it('draws no fill at all when the span is unknown', () => {
    const { UNSAFE_root } = render(<ValidityBar tone="success" fraction={null} />);

    // An empty track beside "100 days remaining" would read as nearly none
    // left — the exact opposite of the truth — so the neutral state is the bare
    // rule, with nothing inside it.
    const widths = stylesIn(UNSAFE_root)
      .map(style => style.width)
      .filter(Boolean);

    expect(widths).toHaveLength(0);
  });

  it('announces a measured bar and hides an unmeasured one', () => {
    const measured = render(<ValidityBar tone="success" fraction={0.4} />);
    expect(measured.getByLabelText('Validity remaining')).toBeTruthy();
    expect(
      measured.getByLabelText('Validity remaining').props.accessibilityValue,
    ).toMatchObject({ now: 40 });

    const neutral = render(<ValidityBar tone="neutral" fraction={null} />);
    expect(neutral.queryByLabelText('Validity remaining')).toBeNull();
  });

  it('carries no percentage label — it is purely visual', () => {
    const { queryByText } = render(<ValidityBar tone="success" fraction={0.25} />);

    expect(queryByText('25%')).toBeNull();
    expect(queryByText(/%/)).toBeNull();
  });

  it('shares the badge’s tone colours, so the two cannot disagree', () => {
    const { UNSAFE_root } = render(<ValidityBar tone="warning" fraction={0.1} />);
    const styles = stylesIn(UNSAFE_root);

    expect(styles.some(s => s.backgroundColor === COLORS.warningBorder)).toBe(true);
    expect(styles.some(s => s.backgroundColor === COLORS.warningText)).toBe(true);
  });

  it('resolves against the dark palette too', () => {
    mockScheme = 'dark';
    const { UNSAFE_root } = render(<ValidityBar tone="success" fraction={0.5} />);

    const styles = stylesIn(UNSAFE_root);
    expect(styles.some(s => s.backgroundColor === DARK_COLORS.successText)).toBe(
      true,
    );
  });
});

/* =====================================================================
 * DetailRow
 * ================================================================== */

describe('DetailRow', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('reads as one node, so a screen reader says "label, value"', () => {
    const { getByLabelText } = render(
      <DetailRow icon="card-outline" label="Card Number" value="389290" />,
    );

    expect(getByLabelText('Card Number, 389290')).toBeTruthy();
  });

  it('gives the value the room, not a truncating fixed slot', () => {
    const { getByText } = render(
      <DetailRow
        icon="business-outline"
        label="Sponsor"
        value="A very long sponsoring company name that would never fit a chip"
      />,
    );

    const value = flatten(getByText(/very long sponsoring/).props.style);
    expect(value.flex).toBe(1);
    // No numberOfLines: the row grows instead of clipping the content.
    expect(getByText(/very long sponsoring/).props.numberOfLines).toBeUndefined();
  });

  it('clears the 44pt touch/row minimum even with one short line', () => {
    const { getByLabelText } = render(
      <DetailRow icon="card-outline" label="No" value="1" />,
    );

    expect(flatten(getByLabelText('No, 1').props.style).minHeight).toBe(60);
  });

  it('weights the value above the label', () => {
    const { getByText } = render(
      <DetailRow icon="card-outline" label="Card Number" value="389290" />,
    );

    const label = flatten(getByText('Card Number').props.style);
    const value = flatten(getByText('389290').props.style);

    expect(Number(value.fontWeight)).toBeGreaterThan(Number(label.fontWeight));
    expect(value.color).toBe(COLORS.textPrimary);
    expect(label.color).toBe(COLORS.textSecondary);
  });

  it('takes its colours from the dark palette when the theme is dark', () => {
    mockScheme = 'dark';
    const { getByText } = render(
      <DetailRow icon="card-outline" label="Card Number" value="389290" />,
    );

    expect(flatten(getByText('389290').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
  });
});

/* =====================================================================
 * ShortcutDetailsModern
 * ================================================================== */

describe('ShortcutDetailsModern', () => {
  beforeEach(() => {
    mockScheme = 'light';
    mockSetOptions.mockClear();
  });

  it('names the document and always carries a subtitle', () => {
    const { getByText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    expect(getByText('Health Card')).toBeTruthy();
    expect(getByText('Health card information')).toBeTruthy();
  });

  it('prints the expiry once — in the countdown card, not also in the hero', () => {
    const { getAllByText, getByText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    expect(getByText('Valid until')).toBeTruthy();
    // Once in the countdown card, once as its own "Expiry Date" row — and not a
    // third time in the hero.
    expect(getAllByText('25 Dec 2025')).toHaveLength(2);
  });

  it('shows the status as a badge rather than plain text', () => {
    const { getByText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    expect(flatten(getByText('Approved').props.style).color).toBe(
      COLORS.successText,
    );
  });

  it('emphasises the countdown as the largest figure on the screen', () => {
    const { getByText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    const days = flatten(getByText('100 days').props.style);
    const heading = flatten(getByText('Health Card').props.style);

    expect(days.fontSize).toBeGreaterThan(heading.fontSize);
    expect(days.color).toBe(COLORS.successText);
  });

  it('turns the countdown to a warning inside the renewal window', () => {
    const { getByText } = render(
      <ShortcutDetailsModern
        title="Residence Permit"
        data={{ ...HEALTH_CARD, remaining_days: '12 Days' }}
        loading={false}
      />,
    );

    expect(flatten(getByText('12 days').props.style).color).toBe(
      COLORS.warningText,
    );
    expect(getByText('Renew soon')).toBeTruthy();
  });

  it('does not pluralise a single day', () => {
    const { getByText } = render(
      <ShortcutDetailsModern
        title="Visa"
        data={{ remaining_days: '1' }}
        loading={false}
      />,
    );

    expect(getByText('1 day')).toBeTruthy();
  });

  it('renders every remaining field as a row, in the server’s order', () => {
    const { getByLabelText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    expect(getByLabelText('Card Number, 389290')).toBeTruthy();
    expect(getByLabelText('Expiry Date, 25 Dec 2025')).toBeTruthy();
  });

  it('shows a dash for an empty field instead of blank space', () => {
    const { getByLabelText } = render(
      <ShortcutDetailsModern
        title="Passport"
        data={{ passport_number: 'A123', place_of_issue: '' }}
        loading={false}
      />,
    );

    expect(getByLabelText('Place Of Issue, —')).toBeTruthy();
  });

  it('works for a document with no status and no countdown', () => {
    const { getByText, getByLabelText, queryByText } = render(
      <ShortcutDetailsModern
        title="Labour Card"
        data={{ labour_card_no: '55512', profession: 'Technician' }}
        loading={false}
      />,
    );

    expect(getByText('Labour Card')).toBeTruthy();
    expect(getByLabelText('Profession, Technician')).toBeTruthy();
    expect(queryByText('Renew soon')).toBeNull();
  });

  it('shows a skeleton while loading, not a bare spinner', () => {
    const { getByLabelText, queryByText } = render(
      <ShortcutDetailsModern title="Health Card" data={{}} loading />,
    );

    expect(getByLabelText('Loading details')).toBeTruthy();
    expect(queryByText('Health Card')).toBeNull();
  });

  it('says there is nothing on file when every value is blank', () => {
    const { getByText } = render(
      <ShortcutDetailsModern
        title="Driving License"
        data={{ a: null, b: '' }}
        loading={false}
      />,
    );

    expect(getByText('No records available')).toBeTruthy();
  });

  it('keeps the ERPGulf link, opening the same URL as before', () => {
    const { Linking } = require('react-native');
    const spy = jest.spyOn(Linking, 'openURL').mockImplementation(() => {});

    const { getByLabelText } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    fireEvent.press(getByLabelText('Open erpgulf.com'));
    expect(spy).toHaveBeenCalledWith('https://erpgulf.com');
    spy.mockRestore();
  });

  it('titles the navigation header with the document name', () => {
    render(
      <ShortcutDetailsModern title="Residence Permit" data={HEALTH_CARD} loading={false} />,
    );

    expect(mockSetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ headerTitle: 'Residence Permit' }),
    );
  });

  it('uses no hardcoded surface — the page follows the palette', () => {
    mockScheme = 'dark';
    const { UNSAFE_root } = render(
      <ShortcutDetailsModern title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    const surfaces = stylesIn(UNSAFE_root)
      .map(style => style.backgroundColor)
      .filter(Boolean);

    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces).not.toContain('#FFFFFF');
    expect(surfaces).toContain(DARK_COLORS.surfaceSecondary);
  });
});

/* =====================================================================
 * The container — what actually routes the three screens
 * ================================================================== */

describe('ShortcutDetails container', () => {
  afterEach(() => {
    mockNewHomeEnabled = true;
  });

  it('renders the modern UI when the toggle is on', () => {
    mockNewHomeEnabled = true;
    const { getByText } = render(
      <ShortcutDetails title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    // Only the modern UI has a hero subtitle and a badge.
    expect(getByText('Health card information')).toBeTruthy();
  });

  it('renders the classic UI untouched when the toggle is off', () => {
    mockNewHomeEnabled = false;
    const { getByText, queryByText } = render(
      <ShortcutDetails title="Health Card" data={HEALTH_CARD} loading={false} />,
    );

    // The classic table shows every field including status, with its raw value
    // and its own "ERPGulf.com" link — none of the modern treatment.
    expect(getByText('Status')).toBeTruthy();
    expect(getByText('Remaining Days')).toBeTruthy();
    expect(getByText('100 Days')).toBeTruthy();
    expect(getByText('2025-12-25')).toBeTruthy();
    expect(getByText('ERPGulf.com')).toBeTruthy();
    expect(queryByText('Health card information')).toBeNull();
  });

  it('passes its props straight through, unchanged', () => {
    mockNewHomeEnabled = false;
    const { getByText } = render(
      <ShortcutDetails title="Passport" data={{}} loading />,
    );

    // The classic loading copy, reached only if `loading` arrived intact.
    expect(getByText('Loading details...')).toBeTruthy();
  });
});

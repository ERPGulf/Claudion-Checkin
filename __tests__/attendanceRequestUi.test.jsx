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

/* eslint-disable import/first */
import PickerField, {
  FIELD_CHROME_WIDTH,
  MIN_VALUE_WIDTH,
  fitsTwoColumns,
} from '../components/common/PickerField';
import ReasonOption from '../components/AttendanceRequest/ReasonOption';
import UploadField from '../components/common/UploadField';
import { formatLogDate } from '../utils/attendanceHistory';
import { formatFieldTime, prefers24Hour } from '../utils/attendanceRequest';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

// The components spread arrays into `style`; flattening is the simplest way to
// assert on the resolved result.
function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

describe('PickerField', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('exposes the label and value together, so the field reads as one control', () => {
    const { getByLabelText, getByText } = render(
      <PickerField
        label="From date"
        value="2026-08-05"
        icon="calendar-outline"
        onPress={jest.fn()}
      />,
    );

    expect(getByText('From date')).toBeTruthy();
    expect(getByLabelText('From date: 2026-08-05')).toBeTruthy();
  });

  it('reports the press so the screen can open its picker', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <PickerField
        label="From time"
        value="09:00 AM"
        icon="time-outline"
        onPress={onPress}
      />,
    );

    fireEvent.press(getByLabelText('From time: 09:00 AM'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads focus as focus, not as an error — no accent outline', () => {
    const base = render(
      <PickerField label="From date" value="x" icon="calendar-outline" onPress={jest.fn()} />,
    );
    const active = render(
      <PickerField
        label="To date"
        value="y"
        icon="calendar-outline"
        onPress={jest.fn()}
        active
      />,
    );

    const idle = flatten(base.getByLabelText('From date: x').props.style);
    const focused = flatten(active.getByLabelText('To date: y').props.style);

    expect(idle.borderColor).toBe(COLORS.cardBorder);
    // The orange accent read as a validation failure; focus now steps the border
    // up to the primary text colour and lifts the surface instead.
    expect(focused.borderColor).toBe(COLORS.textPrimary);
    expect(focused.borderColor).not.toBe(COLORS.primary2);
    expect(idle.backgroundColor).toBe(COLORS.surfaceSecondary);
    expect(focused.backgroundColor).toBe(COLORS.cardBackground);
    expect(focused.shadowRadius).toBeGreaterThan(0);
  });

  it('keeps the error state distinct from focus', () => {
    const { getByLabelText } = render(
      <PickerField
        label="To date"
        value="y"
        icon="calendar-outline"
        onPress={jest.fn()}
        invalid
      />,
    );

    expect(flatten(getByLabelText('To date: y').props.style).borderColor).toBe(
      COLORS.errorBorder,
    );
  });

  it('renders a time field identically to a date field but for glyph and value', () => {
    // The headline requirement: one component, so the two cannot drift.
    const date = render(
      <PickerField label="From date" value="5 Aug 2026" icon="calendar-outline" onPress={jest.fn()} />,
    );
    const time = render(
      <PickerField label="From time" value="11:30 PM" icon="time-outline" onPress={jest.fn()} />,
    );

    const a = flatten(date.getByLabelText('From date: 5 Aug 2026').props.style);
    const b = flatten(time.getByLabelText('From time: 11:30 PM').props.style);

    expect(b.minHeight).toBe(a.minHeight);
    expect(b.borderRadius).toBe(a.borderRadius);
    expect(b.paddingHorizontal).toBe(a.paddingHorizontal);
    expect(b.borderColor).toBe(a.borderColor);
    expect(b.backgroundColor).toBe(a.backgroundColor);
    expect(b.alignItems).toBe(a.alignItems);
    expect(time.getByText('icon:time-outline')).toBeTruthy();
    expect(date.getByText('icon:calendar-outline')).toBeTruthy();
  });

  it('gives the glyph and the chevron equal gutters, so the row is optically even', () => {
    const { getByText } = render(
      <PickerField label="A" value="1" icon="time-outline" onPress={jest.fn()} />,
    );

    expect(flatten(getByText('icon:time-outline').props.style).marginEnd).toBe(
      flatten(getByText('icon:chevron-down').props.style).marginStart,
    );
  });

  it('puts the label above the field, not inside it', () => {
    const { getByText, getByLabelText } = render(
      <PickerField label="From time" value="11:30 PM" icon="time-outline" onPress={jest.fn()} />,
    );

    // The label is not a child of the pressable row.
    const pressable = getByLabelText('From time: 11:30 PM');
    const labelInsideRow = pressable.findAllByType(
      require('react-native').Text,
    ).some((t) => t.props.children === 'From time');
    expect(labelInsideRow).toBe(false);
    expect(getByText('From time')).toBeTruthy();
  });

  it('keeps the border width fixed, so opening a picker never reflows the row', () => {
    const base = render(
      <PickerField label="A" value="1" icon="calendar-outline" onPress={jest.fn()} />,
    );
    const active = render(
      <PickerField label="B" value="2" icon="calendar-outline" onPress={jest.fn()} active />,
    );

    expect(flatten(base.getByLabelText('A: 1').props.style).borderWidth).toBe(1);
    expect(flatten(active.getByLabelText('B: 2').props.style).borderWidth).toBe(1);
  });

  it('uses minHeight so a scaled font can grow the row', () => {
    const { getByLabelText } = render(
      <PickerField label="A" value="1" icon="calendar-outline" onPress={jest.fn()} />,
    );

    const style = flatten(getByLabelText('A: 1').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeUndefined();
  });

  it('never wraps the value — one line, tail-truncated as a last resort', () => {
    const { getByText } = render(
      <PickerField
        label="From date"
        value="5 Aug 2026"
        icon="calendar-outline"
        onPress={jest.fn()}
      />,
    );

    const value = getByText('5 Aug 2026');
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.ellipsizeMode).toBe('tail');
  });

  it('shows a downward chevron, so the row reads as opening a picker in place', () => {
    const { getByText } = render(
      <PickerField label="A" value="1" icon="calendar-outline" onPress={jest.fn()} />,
    );

    // The vector-icons stub renders `icon:<name>`.
    expect(getByText('icon:chevron-down')).toBeTruthy();
  });

  it('resolves dark surfaces from the dark palette', () => {
    mockScheme = 'dark';
    const { getByLabelText } = render(
      <PickerField label="A" value="1" icon="calendar-outline" onPress={jest.fn()} />,
    );

    expect(flatten(getByLabelText('A: 1').props.style).backgroundColor).toBe(
      DARK_COLORS.surfaceSecondary,
    );
  });
});

describe('date & time presentation', () => {
  it('renders a readable date, never the ISO wire format', () => {
    // The wire format stays `2026-08-05` in the payload; only the display moved.
    expect(formatLogDate(new Date(2026, 7, 5, 23, 15))).toBe('5 Aug 2026');
  });

  it('renders a 12-hour clock where the locale expects one', () => {
    expect(formatFieldTime(new Date(2026, 7, 5, 23, 30), false)).toBe('11:30 PM');
    expect(formatFieldTime(new Date(2026, 7, 5, 0, 30), false)).toBe('12:30 AM');
  });

  it('renders a 24-hour clock where the locale expects one', () => {
    expect(formatFieldTime(new Date(2026, 7, 5, 23, 30), true)).toBe('23:30');
    expect(formatFieldTime(new Date(2026, 7, 5, 0, 30), true)).toBe('00:30');
  });

  it('resolves the hour cycle without throwing, whatever Intl offers', () => {
    expect(typeof prefers24Hour()).toBe('boolean');
  });

  it('formats from local components, so a UTC+05:30 device cannot read 5:30 AM', () => {
    // The old `toLocaleTimeString` path rendered a correct local Date through
    // Intl and could resolve it in UTC — turning "now" into the UTC offset.
    // Only the hour *cycle* consults Intl now, which carries no timezone.
    const localMidnight = new Date(2026, 7, 5, 0, 0, 0);
    expect(formatFieldTime(localMidnight, false)).toBe('12:00 AM');
    expect(formatFieldTime(localMidnight, true)).toBe('00:00');
    expect(formatLogDate(localMidnight)).toBe('5 Aug 2026');
  });
});

describe('fitsTwoColumns', () => {
  it('pairs the fields from 390dp up', () => {
    expect(fitsTwoColumns(390)).toBe(true); // iPhone 15/16
    expect(fitsTwoColumns(430)).toBe(true); // iPhone Pro Max
    expect(fitsTwoColumns(834)).toBe(true); // iPad Air
  });

  it('stacks rather than truncate once the label moved back above the field', () => {
    // Putting the label outside returns the glyph to the value's line, which
    // costs the width a 360dp device needed to pair without ellipsising a date.
    expect(fitsTwoColumns(360)).toBe(false);
    expect(fitsTwoColumns(240)).toBe(false);
  });

  it('never pairs unless the value has its full room', () => {
    for (const width of [320, 360, 390, 430, 744]) {
      const column = (width - 16 * 2 - 12 * 2 - 8) / 2;
      if (fitsTwoColumns(width)) {
        expect(column - FIELD_CHROME_WIDTH).toBeGreaterThanOrEqual(
          MIN_VALUE_WIDTH,
        );
      }
    }
  });

  it('decides on measured room, not a hardcoded breakpoint', () => {
    const width = 320;
    const inner = width - 16 * 2 - 12 * 2;
    const column = (inner - 8) / 2;
    expect(fitsTwoColumns(width)).toBe(
      column - FIELD_CHROME_WIDTH >= MIN_VALUE_WIDTH,
    );
  });
});

describe('ReasonOption', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('announces as a radio, not a checkbox — the state is single-select', () => {
    // The classic screen drew expo-checkbox for a single string, which told
    // screen readers each reason was independently toggleable.
    const { getByLabelText } = render(
      <ReasonOption
        label="Work From Home"
        icon="home-outline"
        selected={false}
        onPress={jest.fn()}
      />,
    );

    const option = getByLabelText('Work From Home');
    expect(option.props.accessibilityRole).toBe('radio');
    expect(option.props.accessibilityState.checked).toBe(false);
  });

  it('marks the chosen option as checked', () => {
    const { getByLabelText } = render(
      <ReasonOption label="On Duty" icon="briefcase-outline" selected onPress={jest.fn()} />,
    );

    expect(getByLabelText('On Duty').props.accessibilityState.checked).toBe(true);
  });

  it('weights the label when selected, so the state is visible and not only announced', () => {
    // The bordered, tinted option card is gone for height; selection now reads
    // through the accent glyph, the weighted label and the filled tick.
    const off = render(
      <ReasonOption label="A" icon="home-outline" selected={false} onPress={jest.fn()} />,
    );
    const on = render(
      <ReasonOption label="B" icon="home-outline" selected onPress={jest.fn()} />,
    );

    expect(flatten(off.getByText('A').props.style).fontWeight).toBe('400');
    expect(flatten(on.getByText('B').props.style).fontWeight).toBe('600');
  });

  it('is a row, not a card — no fill or border to pay height for', () => {
    const { getByLabelText } = render(
      <ReasonOption label="A" icon="home-outline" selected={false} onPress={jest.fn()} />,
    );

    const style = flatten(getByLabelText('A').props.style);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
  });

  it('keeps a target past the 44pt minimum despite being compact', () => {
    const { getByLabelText } = render(
      <ReasonOption label="A" icon="home-outline" selected={false} onPress={jest.fn()} />,
    );

    expect(flatten(getByLabelText('A').props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('separates rows with a hairline only between them', () => {
    const withDivider = render(
      <ReasonOption label="A" icon="home-outline" selected={false} onPress={jest.fn()} showDivider />,
    );
    const last = render(
      <ReasonOption label="B" icon="home-outline" selected={false} onPress={jest.fn()} />,
    );

    // The divider is the only 1px-high View in the tree.
    const hairlines = (r) =>
      r.UNSAFE_queryAllByType(require('react-native').View).filter(
        (v) => flatten(v.props.style).height === 1,
      );

    expect(hairlines(withDivider)).toHaveLength(1);
    expect(hairlines(last)).toHaveLength(0);
  });

  it('reports the press', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <ReasonOption label="A" icon="home-outline" selected={false} onPress={onPress} />,
    );

    fireEvent.press(getByLabelText('A'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('UploadField', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('reads as an upload target, with the accepted formats and optional status', () => {
    const { getByText } = render(
      <UploadField file={null} onPick={jest.fn()} onRemove={jest.fn()} />,
    );

    expect(getByText('Upload supporting document')).toBeTruthy();
    expect(getByText('PDF • JPG • PNG')).toBeTruthy();
    expect(getByText('Optional')).toBeTruthy();
  });

  it('stays a compact row while empty — the common case costs little height', () => {
    const { getByLabelText } = render(
      <UploadField file={null} onPick={jest.fn()} onRemove={jest.fn()} />,
    );

    const style = flatten(
      getByLabelText('Upload supporting document. Optional.').props.style,
    );
    expect(style.minHeight).toBeLessThanOrEqual(56);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.flexDirection).toBe('row');
  });

  it('uses a dashed outline only while empty', () => {
    const empty = render(<UploadField file={null} onPick={jest.fn()} onRemove={jest.fn()} />);
    const target = empty.getByLabelText('Upload supporting document. Optional.');

    expect(flatten(target.props.style).borderStyle).toBe('dashed');
  });

  it('forwards the press to the same picker the classic screen uses', () => {
    const onPick = jest.fn();
    const { getByLabelText } = render(
      <UploadField file={null} onPick={onPick} onRemove={jest.fn()} />,
    );

    fireEvent.press(getByLabelText('Upload supporting document. Optional.'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('shows the filename once attached, and stays tappable to replace it', () => {
    const onPick = jest.fn();
    const { getByText, getByLabelText } = render(
      <UploadField
        file={{ name: 'medical-note.pdf', uri: 'file:///a.pdf', type: 'application/pdf' }}
        onPick={onPick}
        onRemove={jest.fn()}
      />,
    );

    expect(getByText('Attached')).toBeTruthy();
    expect(getByText('medical-note.pdf')).toBeTruthy();

    fireEvent.press(getByLabelText('Attached: medical-note.pdf. Tap to replace.'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('offers a discrete remove control', () => {
    const onRemove = jest.fn();
    const { getByLabelText } = render(
      <UploadField
        file={{ name: 'a.pdf', uri: 'file:///a.pdf', type: 'application/pdf' }}
        onPick={jest.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.press(getByLabelText('Remove attachment'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('right-aligns an Arabic filename, which Frappe returns regularly', () => {
    const { getByText } = render(
      <UploadField
        file={{ name: 'إجازة.pdf', uri: 'file:///a.pdf', type: 'application/pdf' }}
        onPick={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(flatten(getByText('إجازة.pdf').props.style).textAlign).toBe('right');
  });

  it('does not render an image preview for a document', () => {
    const { UNSAFE_queryAllByType } = render(
      <UploadField
        file={{ name: 'a.pdf', uri: 'file:///a.pdf', type: 'application/pdf' }}
        onPick={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    const { Image } = require('react-native');
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('previews an image attachment', () => {
    const { UNSAFE_queryAllByType } = render(
      <UploadField
        file={{ name: 'photo.jpg', uri: 'file:///a.jpg', type: 'image/jpeg' }}
        onPick={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    const { Image } = require('react-native');
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(1);
  });
});

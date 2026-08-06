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
  };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// services/api re-exports the attendance service, which pulls in expo-location,
// and the attachment picker pulls in expo-image-picker — both untransformed
// under this jest config. Only `formatDate` and the sentinel are needed here.
jest.mock('../services/api', () => ({
  createLeaveApplication: jest.fn(),
  getLeaveTypes: jest.fn(() => Promise.resolve({ message: [] })),
  uploadLeaveAttachment: jest.fn(),
}));

jest.mock('../hooks/useAttachmentPicker', () => ({
  useAttachmentPicker: () => ({
    pickFromCamera: jest.fn(),
    pickFromGallery: jest.fn(),
    pickDocument: jest.fn(),
  }),
}));

/* eslint-disable import/first */
import {
  countLeaveDays,
  formatLeaveDuration,
  leaveTypeIcon,
} from '../utils/leaveRequest';
import { formatDate, NO_LEAVE_TYPE } from '../hooks/useLeaveRequest';
import PickerField from '../components/common/PickerField';
import OptionSheet from '../components/common/OptionSheet';
import { COLORS } from '../constants';
/* eslint-enable import/first */

function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

/* =====================================================================
 * Duration — the only thing the summary card derives
 * ================================================================== */

describe('countLeaveDays', () => {
  it('counts inclusively, so a single-day leave is one day', () => {
    const day = new Date(2026, 7, 6);
    expect(countLeaveDays(day, day)).toBe(1);
  });

  it('counts a range end to end', () => {
    expect(countLeaveDays(new Date(2026, 7, 6), new Date(2026, 7, 8))).toBe(3);
  });

  it('is unaffected by the time of day on either date', () => {
    // The pickers hand back whatever time the Date happened to carry; a range
    // must not come back a day short because one end was late in the evening.
    const from = new Date(2026, 7, 6, 23, 59);
    const to = new Date(2026, 7, 8, 0, 1);
    expect(countLeaveDays(from, to)).toBe(3);
  });

  it('spans a month and a year boundary correctly', () => {
    expect(countLeaveDays(new Date(2026, 0, 30), new Date(2026, 1, 2))).toBe(4);
    expect(countLeaveDays(new Date(2025, 11, 30), new Date(2026, 0, 2))).toBe(4);
  });

  it('returns null for an inverted range rather than a negative count', () => {
    expect(countLeaveDays(new Date(2026, 7, 8), new Date(2026, 7, 6))).toBeNull();
  });

  it('returns null for an unusable date', () => {
    expect(countLeaveDays(new Date('nope'), new Date())).toBeNull();
    expect(countLeaveDays(null, undefined)).toBeNull();
  });
});

describe('formatLeaveDuration', () => {
  it('does not pluralise a single day', () => {
    expect(formatLeaveDuration(1)).toBe('1 day');
    expect(formatLeaveDuration(3)).toBe('3 days');
  });

  it('has nothing to say about an uncountable range', () => {
    expect(formatLeaveDuration(null)).toBeNull();
  });
});

/* =====================================================================
 * Leave type icons
 * ================================================================== */

describe('leaveTypeIcon', () => {
  it('matches on a substring, since leave types are tenant-configured', () => {
    expect(leaveTypeIcon('Annual Leave')).toBe('sunny-outline');
    expect(leaveTypeIcon('Sick Leave')).toBe('medkit-outline');
    expect(leaveTypeIcon('Remote')).toBe('home-outline');
    expect(leaveTypeIcon('Work From Home')).toBe('home-outline');
    expect(leaveTypeIcon('Leave Without Pay')).toBe('wallet-outline');
  });

  it('falls back to a neutral calendar rather than a wrong picture', () => {
    expect(leaveTypeIcon('Special Consideration')).toBe('calendar-outline');
    expect(leaveTypeIcon(undefined)).toBe('calendar-outline');
  });
});

/* =====================================================================
 * Wire format — must not have drifted from the classic screen
 * ================================================================== */

describe('formatDate', () => {
  it('emits local YYYY-MM-DD, exactly as the classic screen did', () => {
    expect(formatDate(new Date(2026, 7, 6))).toBe('2026-08-06');
    expect(formatDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('keeps the classic fallback string for an unusable date', () => {
    expect(formatDate(null)).toBe('Select date');
    expect(formatDate(new Date('nope'))).toBe('Select date');
  });

  it('still exposes the picker sentinel the payload check depends on', () => {
    expect(NO_LEAVE_TYPE).toBe('__none__');
  });
});

/* =====================================================================
 * PickerField — the read-only state Posting Date needed
 * ================================================================== */

describe('PickerField readOnly', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('is unchanged for every existing caller — still a button with a chevron', () => {
    const { getByLabelText, getByText } = render(
      <PickerField
        label="From date"
        value="6 Aug 2026"
        icon="calendar-outline"
        onPress={jest.fn()}
      />,
    );

    const field = getByLabelText('From date: 6 Aug 2026');
    expect(field.props.accessibilityHint).toBe('Opens a picker');
    expect(getByText('icon:chevron-down')).toBeTruthy();
  });

  it('drops the chevron when read-only — there is nothing to open', () => {
    const { queryByText } = render(
      <PickerField
        readOnly
        label="Posting date"
        value="6 Aug 2026"
        icon="today-outline"
      />,
    );

    expect(queryByText('icon:chevron-down')).toBeNull();
  });

  it('announces itself as disabled rather than as a button', () => {
    const { getByLabelText } = render(
      <PickerField
        readOnly
        label="Posting date"
        value="6 Aug 2026"
        icon="today-outline"
      />,
    );

    const field = getByLabelText('Posting date: 6 Aug 2026');
    expect(field.props.accessibilityState).toMatchObject({ disabled: true });
    // No "Opens a picker" promise it cannot keep.
    expect(field.props.accessibilityHint).toBeUndefined();
  });

  it('mutes the value so it does not read as editable', () => {
    const editable = render(
      <PickerField label="From" value="6 Aug 2026" icon="calendar-outline" onPress={jest.fn()} />,
    );
    const readOnly = render(
      <PickerField readOnly label="Posting" value="6 Aug 2026" icon="today-outline" />,
    );

    expect(flatten(editable.getByText('6 Aug 2026').props.style).color).toBe(
      COLORS.textPrimary,
    );
    expect(flatten(readOnly.getByText('6 Aug 2026').props.style).color).toBe(
      COLORS.textMuted,
    );
  });

  it('keeps the same height, so a read-only field stays in the column', () => {
    const editable = render(
      <PickerField label="From" value="X" icon="calendar-outline" onPress={jest.fn()} />,
    );
    const readOnly = render(
      <PickerField readOnly label="Posting" value="X" icon="today-outline" />,
    );

    expect(flatten(readOnly.getByLabelText('Posting: X').props.style).minHeight).toBe(
      flatten(editable.getByLabelText('From: X').props.style).minHeight,
    );
  });
});

/* =====================================================================
 * OptionSheet — the picker replacement, now shared with Expense Claims
 * ================================================================== */

describe('OptionSheet', () => {
  const types = ['Annual Leave', 'Sick Leave', 'Remote'];

  beforeEach(() => {
    mockScheme = 'light';
  });

  it('lists every option the server returned', () => {
    const { getByText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={types}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    types.forEach(type => expect(getByText(type)).toBeTruthy());
  });

  it('hands back the raw server string, so the payload is unchanged', () => {
    const onSelect = jest.fn();
    const { getByLabelText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={types}
        onSelect={onSelect}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(getByLabelText('Annual Leave'));
    expect(onSelect).toHaveBeenCalledWith('Annual Leave');
  });

  it('marks the current choice for a screen reader, not just with a tick', () => {
    const { getByLabelText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={types}
        selected="Remote"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(getByLabelText('Remote').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Sick Leave').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('takes a caller-supplied glyph rule', () => {
    const { getByText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={['Sick Leave']}
        iconForOption={leaveTypeIcon}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(getByText('icon:medkit-outline')).toBeTruthy();
  });

  it('says so when the tenant has configured nothing', () => {
    const { getByText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={[]}
        emptyTitle="No leave types"
        emptyDescription="Ask your administrator."
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(getByText('No leave types')).toBeTruthy();
  });

  it('offers each option a large touch target', () => {
    const { getByLabelText } = render(
      <OptionSheet
        visible
        title="Leave type"
        options={types}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(
      flatten(getByLabelText('Annual Leave').props.style).minHeight,
    ).toBeGreaterThanOrEqual(44);
  });
});

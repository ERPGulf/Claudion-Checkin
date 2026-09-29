import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import {
  render,
  renderHook,
  fireEvent,
  act,
} from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons/Entypo', () => {
  const { Text } = require('react-native');
  return ({ name }) => <Text>{`entypo:${name}`}</Text>;
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    __esModule: true,
    default: stub,
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

jest.mock('@react-native-community/datetimepicker', () => {
  const { Text } = require('react-native');
  return ({ minimumDate }) => (
    <Text>{`picker:${minimumDate ? minimumDate.toISOString() : ''}`}</Text>
  );
});

const mockNavigation = { setOptions: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

jest.mock('../services/api/resignation.service', () => ({
  submitResignation: jest.fn(),
}));

const mockPickers = {
  pickFromCamera: jest.fn(),
  pickFromGallery: jest.fn(),
  pickDocument: jest.fn(),
};
jest.mock('../hooks/useAttachmentPicker', () => ({
  useAttachmentPicker: () => mockPickers,
}));

/* eslint-disable import/first */
import Resignation from '../screens/Resignation';
import ResignationLegacy from '../screens/ResignationLegacy';
import useResignation from '../hooks/useResignation';
import { submitResignation } from '../services/api/resignation.service';
import {
  formatResignationDate,
  formatResignationDayLabel,
  earliestResignationDate,
} from '../utils/resignation';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

/** What the backend returns, unwrapped by the service. */
const CREATED = {
  message: {
    name: 16,
    employee: 'HR-EMP-00001',
    resignation_date: '2026-09-02 11:46:09',
    reason: 'test',
    file_url: [],
  },
};

const FILE = {
  uri: 'file:///tmp/letter.pdf',
  name: 'letter.pdf',
  type: 'application/pdf',
};

/** Presses the "Submit" button of the confirmation Alert. */
const confirmLastAlert = async () => {
  const buttons = Alert.alert.mock.calls.at(-1)[2];
  const submit = buttons.find(b => b.text === 'Submit');
  await act(async () => {
    await submit.onPress();
  });
};

beforeEach(() => {
  mockScheme = 'light';
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Alert.alert.mockRestore();
});

/* =====================================================================
 * Presentation
 * ================================================================== */

describe('Resignation screen', () => {
  it('introduces the screen and shows the form card', () => {
    const { getByText } = render(<Resignation />);

    expect(getByText('Resignation')).toBeTruthy();
    expect(getByText('Resignation details')).toBeTruthy();
    expect(getByText('Resignation date *')).toBeTruthy();
    expect(getByText('Reason *')).toBeTruthy();
  });

  it('uses the shared modern header', () => {
    render(<Resignation />);

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Resignation');
    expect(options.headerShown).toBe(true);
  });

  it('offers the primary action and says what happens next', () => {
    const { getByLabelText, getByText } = render(<Resignation />);

    expect(getByLabelText('Submit resignation')).toBeTruthy();
    expect(getByText('What happens next')).toBeTruthy();
  });

  it('opens the date picker with today as the earliest date', () => {
    const { getByLabelText, queryByText, getByText } = render(<Resignation />);

    expect(queryByText(/^picker:/)).toBeNull();
    fireEvent.press(getByLabelText(/^Resignation date \*: /));
    expect(
      getByText(`picker:${earliestResignationDate().toISOString()}`),
    ).toBeTruthy();
  });

  it('offers two optional attachment slots, like Loan application', () => {
    const { getByText, getByLabelText } = render(<Resignation />);

    expect(getByText('Attachments')).toBeTruthy();
    expect(getByText('Attachment 1')).toBeTruthy();
    expect(getByText('Attachment 2')).toBeTruthy();
    expect(
      getByLabelText('Attachment 1. Upload supporting document. Optional.'),
    ).toBeTruthy();
    expect(
      getByLabelText('Attachment 2. Upload supporting document. Optional.'),
    ).toBeTruthy();
  });

  it('keeps the button pressable so validation can run', () => {
    const { getByLabelText } = render(<Resignation />);

    expect(
      getByLabelText('Submit resignation').props.accessibilityState.disabled,
    ).toBe(false);
  });
});

/* =====================================================================
 * Submission
 * ================================================================== */

describe('submitting a resignation', () => {
  it('asks for a reason before anything else', () => {
    const { getByLabelText } = render(<Resignation />);

    fireEvent.press(getByLabelText('Submit resignation'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Validation',
      'Please enter a reason for your resignation',
    );
    expect(submitResignation).not.toHaveBeenCalled();
  });

  it('treats whitespace as an empty reason', () => {
    const { getByLabelText } = render(<Resignation />);

    fireEvent.changeText(getByLabelText('Resignation reason'), '   ');
    fireEvent.press(getByLabelText('Submit resignation'));

    expect(Alert.alert.mock.calls[0][0]).toBe('Validation');
  });

  it('confirms before sending, and sends nothing on cancel', () => {
    const { getByLabelText } = render(<Resignation />);

    fireEvent.changeText(getByLabelText('Resignation reason'), 'Relocating');
    fireEvent.press(getByLabelText('Submit resignation'));

    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Submit resignation?');
    expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Submit']);
    expect(submitResignation).not.toHaveBeenCalled();
  });

  it('sends the date and trimmed reason, then shows the reference', async () => {
    submitResignation.mockResolvedValue(CREATED);
    const { getByLabelText, getByText } = render(<Resignation />);

    fireEvent.changeText(getByLabelText('Resignation reason'), ' Relocating ');
    fireEvent.press(getByLabelText('Submit resignation'));
    await confirmLastAlert();

    const payload = submitResignation.mock.calls[0][0];
    expect(payload.reason).toBe('Relocating');
    expect(payload.resignationDate).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(getByText('Resignation submitted')).toBeTruthy();
    expect(getByText(/Reference 16/)).toBeTruthy();
  });
});

/* =====================================================================
 * useResignation
 * ================================================================== */

describe('useResignation', () => {
  const submitAndConfirm = async result => {
    act(() => result.current.submitResignation());
    await confirmLastAlert();
  };

  it('resets the form after a success', async () => {
    submitResignation.mockResolvedValue(CREATED);
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setReason('Relocating'));
    await submitAndConfirm(result);

    expect(result.current.reason).toBe('');
    expect(result.current.submitted).toEqual(CREATED.message);
    expect(result.current.loading).toBe(false);
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Success',
      'Your resignation has been submitted',
    );
  });

  it('keeps what was typed when the service fails', async () => {
    submitResignation.mockResolvedValue({ error: 'Unable to submit.' });
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setReason('Relocating'));
    await submitAndConfirm(result);

    expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Unable to submit.');
    expect(result.current.reason).toBe('Relocating');
    expect(result.current.submitted).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('never files two resignations from a double tap on confirm', async () => {
    let resolve;
    submitResignation.mockReturnValue(
      new Promise(r => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setReason('Relocating'));
    act(() => result.current.submitResignation());
    const submit = Alert.alert.mock.calls.at(-1)[2].find(
      b => b.text === 'Submit',
    );

    await act(async () => {
      submit.onPress();
      submit.onPress();
      resolve(CREATED);
    });

    expect(submitResignation).toHaveBeenCalledTimes(1);
  });

  it('sends both attachments with the resignation, then clears them', async () => {
    submitResignation.mockResolvedValue(CREATED);
    const { result } = renderHook(() => useResignation());
    const SECOND = { ...FILE, name: 'notice.png', type: 'image/png' };

    act(() => result.current.setReason('Relocating'));
    act(() => result.current.setFile1(FILE));
    act(() => result.current.setFile2(SECOND));
    await submitAndConfirm(result);

    const payload = submitResignation.mock.calls[0][0];
    expect(payload.file1).toEqual(FILE);
    expect(payload.file2).toEqual(SECOND);
    expect(result.current.file1).toBeNull();
    expect(result.current.file2).toBeNull();
  });

  it('sends no files when nothing is attached', async () => {
    submitResignation.mockResolvedValue(CREATED);
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setReason('Relocating'));
    await submitAndConfirm(result);

    const payload = submitResignation.mock.calls[0][0];
    expect(payload.file1).toBeNull();
    expect(payload.file2).toBeNull();
  });

  it('keeps the attachments when the submission fails', async () => {
    submitResignation.mockResolvedValue({ error: 'Unable to submit.' });
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setReason('Relocating'));
    act(() => result.current.setFile1(FILE));
    await submitAndConfirm(result);

    expect(result.current.file1).toEqual(FILE);
  });

  it('fills the slot that opened the sheet', async () => {
    jest.useFakeTimers();
    mockPickers.pickDocument.mockResolvedValue(FILE);
    const { result } = renderHook(() => useResignation());

    act(() => result.current.pickFile2());
    expect(result.current.isBottomSheetVisible).toBe(true);

    act(() => result.current.handlePickDocument());
    // Dismissed first: presenting a picker over a closing modal drops it.
    expect(result.current.isBottomSheetVisible).toBe(false);
    expect(mockPickers.pickDocument).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(mockPickers.pickDocument).toHaveBeenCalledTimes(1);
    expect(result.current.file2).toEqual(FILE);
    expect(result.current.file1).toBeNull();
    jest.useRealTimers();
  });

  it('keeps the existing file when the picker is cancelled', async () => {
    jest.useFakeTimers();
    mockPickers.pickFromCamera.mockResolvedValue(null);
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setFile1(FILE));
    act(() => result.current.pickFile1());
    act(() => result.current.handlePickCamera());
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(result.current.file1).toEqual(FILE);
    jest.useRealTimers();
  });

  it('removes each attachment independently', () => {
    const { result } = renderHook(() => useResignation());

    act(() => result.current.setFile1(FILE));
    act(() => result.current.setFile2(FILE));
    act(() => result.current.removeFile1());

    expect(result.current.file1).toBeNull();
    expect(result.current.file2).toEqual(FILE);
  });

  it('ignores a dismissed or invalid date pick', () => {
    const { result } = renderHook(() => useResignation());
    const before = result.current.resignationDate;

    act(() => result.current.openDatePicker());
    expect(result.current.showDatePicker).toBe(true);

    act(() =>
      result.current.handleDateChange({ type: 'dismissed' }, new Date(2030, 0, 1)),
    );
    expect(result.current.showDatePicker).toBe(false);
    expect(result.current.resignationDate).toBe(before);

    act(() => result.current.handleDateChange({ type: 'set' }, 'not a date'));
    expect(result.current.resignationDate).toBe(before);
  });

  it('accepts a chosen date', () => {
    const { result } = renderHook(() => useResignation());
    const chosen = new Date(2030, 0, 15, 9, 30, 0);

    act(() => result.current.handleDateChange({ type: 'set' }, chosen));

    expect(result.current.resignationDate).toEqual(chosen);
  });
});

/* =====================================================================
 * Domain util
 * ================================================================== */

describe('resignation utils', () => {
  it('formats the date the way the endpoint expects', () => {
    expect(formatResignationDate(new Date(2026, 8, 2, 11, 46, 9))).toBe(
      '2026-09-02 11:46:09',
    );
  });

  it('labels a day the way the classic screens do', () => {
    expect(formatResignationDayLabel(new Date(2026, 8, 2, 11, 46, 9))).toBe(
      '2026-09-02',
    );
  });

  it('starts the selectable range at midnight today', () => {
    const earliest = earliestResignationDate(new Date(2026, 8, 2, 11, 46, 9));
    expect(earliest).toEqual(new Date(2026, 8, 2, 0, 0, 0));
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('Resignation in dark mode', () => {
  it('takes every colour from the palette', () => {
    const light = render(<Resignation />);
    expect(flatten(light.getByText('Resignation').props.style).color).toBe(
      COLORS.textPrimary,
    );

    mockScheme = 'dark';
    const dark = render(<Resignation />);
    expect(flatten(dark.getByText('Resignation').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    expect(
      flatten(dark.getByText('Resignation details').props.style).color,
    ).toBe(DARK_COLORS.textPrimary);
  });
});

/* =====================================================================
 * Classic screen — same flow, classic look
 * ================================================================== */

describe('classic Resignation screen', () => {
  it('uses the classic header like the other classic screens', () => {
    render(<ResignationLegacy />);

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Resignation');
    expect(options.headerTitleAlign).toBe('center');
    expect(options.headerShadowVisible).toBe(false);
  });

  it('shows the classic form fields and submit button', () => {
    const { getByText, getByPlaceholderText } = render(<ResignationLegacy />);

    expect(getByText('Resignation Details')).toBeTruthy();
    expect(getByText('Resignation Date')).toBeTruthy();
    expect(getByText('Reason')).toBeTruthy();
    expect(getByPlaceholderText('Enter your reason for resigning...')).toBeTruthy();
    expect(getByText('Submit Resignation')).toBeTruthy();
    expect(getByText('Attachment 1 (optional)')).toBeTruthy();
    expect(getByText('Attachment 2 (optional)')).toBeTruthy();
  });

  it('opens the date picker from the date field', () => {
    const { getByLabelText, queryByText, getByText } = render(
      <ResignationLegacy />,
    );

    expect(queryByText(/^picker:/)).toBeNull();
    fireEvent.press(getByLabelText(/^Resignation date: /));
    expect(
      getByText(`picker:${earliestResignationDate().toISOString()}`),
    ).toBeTruthy();
  });

  it('runs the same validation, confirmation and request', async () => {
    submitResignation.mockResolvedValue(CREATED);
    const { getByText, getByLabelText } = render(<ResignationLegacy />);

    fireEvent.press(getByText('Submit Resignation'));
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Validation',
      'Please enter a reason for your resignation',
    );

    fireEvent.changeText(getByLabelText('Resignation reason'), 'Relocating');
    fireEvent.press(getByText('Submit Resignation'));
    expect(Alert.alert.mock.calls.at(-1)[0]).toBe('Submit resignation?');

    await confirmLastAlert();
    expect(submitResignation).toHaveBeenCalledTimes(1);
    expect(submitResignation.mock.calls[0][0].reason).toBe('Relocating');
  });
});

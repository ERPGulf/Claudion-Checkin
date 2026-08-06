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

// The screen must not reach a real endpoint, and the service also pulls in
// attendance.service (expo-location), which this jest config does not transform.
jest.mock('../services/api/complaint.service', () => ({
  createComplaint: jest.fn(),
  uploadComplaintAttachment: jest.fn(),
}));

// Dereferenced at render time, not at module init, so the const below is
// initialised by the time the factory's object is used.
const mockPickers = {
  pickFromCamera: jest.fn(),
  pickFromGallery: jest.fn(),
  pickDocument: jest.fn(),
};
jest.mock('../hooks/useAttachmentPicker', () => ({
  useAttachmentPicker: () => mockPickers,
}));

// Lets one block render the screen against a fixed state (a picked file) without
// driving the native picker; every other block gets the real hook.
let mockHookOverride = null;
jest.mock('../hooks/useComplaint', () => {
  const actual = jest.requireActual('../hooks/useComplaint');
  return {
    __esModule: true,
    default: (...args) => mockHookOverride || actual.default(...args),
  };
});

/* eslint-disable import/first */
import Complaints from '../screens/Complaints';
import useComplaint from '../hooks/useComplaint';
import FormField from '../components/common/FormField';
import {
  createComplaint,
  uploadComplaintAttachment,
} from '../services/api/complaint.service';
import { COLORS, DARK_COLORS, TYPO } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

const FILE = {
  uri: 'file:///tmp/evidence.pdf',
  name: 'evidence.pdf',
  type: 'application/pdf',
};

/** What the backend actually returns: the docname is two `message` keys deep. */
const created = name => ({ message: { message: { name } } });

beforeEach(() => {
  mockScheme = 'light';
  mockHookOverride = null;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Alert.alert.mockRestore();
});

/* =====================================================================
 * Presentation
 * ================================================================== */

describe('modern Complaints screen', () => {
  it('introduces the screen in two lines above the form', () => {
    const { getByText } = render(<Complaints />);

    expect(getByText('Complaint')).toBeTruthy();
    expect(
      getByText(
        'Submit feedback or report an issue. The relevant department reviews it.',
      ),
    ).toBeTruthy();
  });

  it('puts the form in a titled card', () => {
    const { getByText } = render(<Complaints />);

    expect(getByText('Complaint details')).toBeTruthy();
    expect(getByText("Describe the issue you're experiencing")).toBeTruthy();
  });

  it('keeps the classic placeholder on the message field', () => {
    const { getByPlaceholderText } = render(<Complaints />);

    expect(getByPlaceholderText('Enter your message here...')).toBeTruthy();
  });

  it('reuses the shared upload target rather than a bare button', () => {
    const { getByText, getByLabelText } = render(<Complaints />);

    expect(getByText('Upload supporting document')).toBeTruthy();
    expect(getByText('PDF • JPG • PNG')).toBeTruthy();
    expect(getByText('Optional')).toBeTruthy();
    expect(
      getByLabelText('Upload supporting document. Optional.'),
    ).toBeTruthy();
  });

  it('offers the primary action and says what happens next', () => {
    const { getByLabelText, getByText } = render(<Complaints />);

    expect(getByLabelText('Submit complaint')).toBeTruthy();
    expect(getByText('What happens next')).toBeTruthy();
  });

  it('uses the shared modern header, so the title and back button match', () => {
    render(<Complaints />);

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Complaints');
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe('function');
  });

  it('gives the submit button a full-width 44pt-plus target', () => {
    const { getByLabelText } = render(<Complaints />);

    expect(
      flatten(getByLabelText('Submit complaint').props.style).minHeight,
    ).toBeGreaterThanOrEqual(44);
  });

  it('starts the message box at four lines and grows from there', () => {
    const { getByLabelText } = render(<Complaints />);

    const input = getByLabelText('Complaint message');
    // A floor, not a cap: no fixed height and no maxHeight, so the field grows
    // with the text instead of scrolling inside itself.
    const style = flatten(input.props.style);
    expect(style.minHeight).toBe(64 + TYPO.body.lineHeight);
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
    expect(input.props.multiline).toBe(true);
  });
});

/* =====================================================================
 * Summary — derived from state the screen already has
 * ================================================================== */

describe('complaint summary', () => {
  it('stays hidden until there is something to send', () => {
    const { queryByText } = render(<Complaints />);

    expect(queryByText('Ready to submit')).toBeNull();
  });

  it('appears once a message is typed', () => {
    const { getByLabelText, getByText } = render(<Complaints />);

    fireEvent.changeText(getByLabelText('Complaint message'), 'The AC is off');

    expect(getByText('Ready to submit')).toBeTruthy();
    expect(getByText('None')).toBeTruthy();
  });

  it('counts an attached file', () => {
    mockHookOverride = {
      message: 'The AC is off',
      file: FILE,
      loading: false,
      isBottomSheetVisible: false,
      setMessage: jest.fn(),
      setFile: jest.fn(),
      pickFile: jest.fn(),
      closeBottomSheet: jest.fn(),
      removeFile: jest.fn(),
      handlePickCamera: jest.fn(),
      handlePickGallery: jest.fn(),
      handlePickDocument: jest.fn(),
      submitComplaint: jest.fn(),
      hasMessage: true,
      attachmentCount: 1,
    };

    const { getByText } = render(<Complaints />);

    expect(getByText('1 file attached')).toBeTruthy();
    // And the shared upload target shows the filename with a remove button.
    expect(getByText('evidence.pdf')).toBeTruthy();
    expect(getByText('icon:document-text-outline')).toBeTruthy();
  });
});

/* =====================================================================
 * Validation and submission — must match the classic screen exactly
 * ================================================================== */

describe('submitting from the modern screen', () => {
  it('raises the classic validation alert on an empty message', () => {
    const { getByLabelText } = render(<Complaints />);

    fireEvent.press(getByLabelText('Submit complaint'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Validation',
      'Please enter complaint message',
    );
    expect(createComplaint).not.toHaveBeenCalled();
  });

  it('treats whitespace as empty, exactly as before', () => {
    const { getByLabelText } = render(<Complaints />);

    fireEvent.changeText(getByLabelText('Complaint message'), '   ');
    fireEvent.press(getByLabelText('Submit complaint'));

    expect(createComplaint).not.toHaveBeenCalled();
  });

  it('is pressable with an empty message, so validation still runs', () => {
    // Disabling the button would swallow the Alert the classic screen shows.
    const { getByLabelText } = render(<Complaints />);

    expect(
      getByLabelText('Submit complaint').props.accessibilityState.disabled,
    ).toBe(false);
  });

  it('sends the same payload the classic screen sent', async () => {
    createComplaint.mockResolvedValue(created('EC-0001'));

    const { getByLabelText } = render(<Complaints />);

    fireEvent.changeText(getByLabelText('Complaint message'), 'The AC is off');

    await act(async () => {
      fireEvent.press(getByLabelText('Submit complaint'));
    });

    expect(createComplaint).toHaveBeenCalledTimes(1);
    const payload = createComplaint.mock.calls[0][0];
    expect(payload.message).toBe('The AC is off');
    // `YYYY-MM-DD HH:mm:ss`, the string the classic screen built.
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

/* =====================================================================
 * useComplaint — the lifted flow
 * ================================================================== */

describe('useComplaint', () => {
  const submit = async result => {
    await act(async () => {
      await result.current.submitComplaint();
    });
  };

  const withMessage = (result, text = 'The AC is off') => {
    act(() => result.current.setMessage(text));
  };

  it('creates, then uploads the attachment against the new docname', async () => {
    createComplaint.mockResolvedValue(created('EC-0007'));
    uploadComplaintAttachment.mockResolvedValue({});

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    act(() => result.current.setFile(FILE));
    await submit(result);

    expect(uploadComplaintAttachment).toHaveBeenCalledWith(FILE, 'EC-0007');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Complaint submitted successfully',
    );
  });

  it('skips the upload when nothing is attached', async () => {
    createComplaint.mockResolvedValue(created('EC-0008'));

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    await submit(result);

    expect(uploadComplaintAttachment).not.toHaveBeenCalled();
  });

  it('clears the form only after a success', async () => {
    createComplaint.mockResolvedValue(created('EC-0009'));

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    act(() => result.current.setFile(FILE));
    await submit(result);

    expect(result.current.message).toBe('');
    expect(result.current.file).toBeNull();
  });

  it('surfaces a service error and keeps what the user typed', async () => {
    createComplaint.mockResolvedValue({ error: 'Session expired.' });

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    await submit(result);

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Session expired.');
    expect(result.current.message).toBe('The AC is off');
  });

  it('reports a missing docname rather than uploading against nothing', async () => {
    createComplaint.mockResolvedValue({ message: {} });

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    await submit(result);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Complaint created but docname missing',
    );
    expect(uploadComplaintAttachment).not.toHaveBeenCalled();
  });

  it('drops the loading flag even when the create throws', async () => {
    createComplaint.mockRejectedValue(new Error('Network down'));

    const { result } = renderHook(() => useComplaint());
    withMessage(result);
    await submit(result);

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Network down');
    expect(result.current.loading).toBe(false);
  });

  it('closes the sheet before the native picker opens, then keeps the file', async () => {
    jest.useFakeTimers();
    mockPickers.pickDocument.mockResolvedValue(FILE);

    const { result } = renderHook(() => useComplaint());

    act(() => result.current.pickFile());
    expect(result.current.isBottomSheetVisible).toBe(true);

    act(() => result.current.handlePickDocument());
    // Dismissed first: presenting a picker over a closing modal drops it.
    expect(result.current.isBottomSheetVisible).toBe(false);
    expect(mockPickers.pickDocument).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(mockPickers.pickDocument).toHaveBeenCalledTimes(1);
    expect(result.current.file).toEqual(FILE);
    expect(result.current.attachmentCount).toBe(1);

    jest.useRealTimers();
  });

  it('keeps the existing file when the picker is cancelled', async () => {
    jest.useFakeTimers();
    mockPickers.pickFromCamera.mockResolvedValue(null);

    const { result } = renderHook(() => useComplaint());
    act(() => result.current.setFile(FILE));

    act(() => result.current.handlePickCamera());
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(result.current.file).toEqual(FILE);

    jest.useRealTimers();
  });

  it('removes an attachment', () => {
    const { result } = renderHook(() => useComplaint());

    act(() => result.current.setFile(FILE));
    act(() => result.current.removeFile());

    expect(result.current.file).toBeNull();
    expect(result.current.attachmentCount).toBe(0);
  });
});

/* =====================================================================
 * FormField — the two additions Complaints needed
 * ================================================================== */

describe('FormField minLines', () => {
  const heightOf = element => flatten(element.props.style).minHeight;

  it('leaves the existing three-line callers exactly as they were', () => {
    const { getByLabelText } = render(
      <FormField label="Reason" value="" multiline onChangeText={jest.fn()} />,
    );

    expect(heightOf(getByLabelText('Reason'))).toBe(64);
  });

  it('grows by whole lines of body type', () => {
    const { getByLabelText } = render(
      <FormField
        label="Message"
        value=""
        multiline
        minLines={4}
        onChangeText={jest.fn()}
      />,
    );

    expect(heightOf(getByLabelText('Message'))).toBe(64 + TYPO.body.lineHeight);
  });

  it('never shrinks below the three-line box', () => {
    const { getByLabelText } = render(
      <FormField
        label="Message"
        value=""
        multiline
        minLines={1}
        onChangeText={jest.fn()}
      />,
    );

    expect(heightOf(getByLabelText('Message'))).toBe(64);
  });

  it('does not touch a single-line field', () => {
    const { getByLabelText } = render(
      <FormField
        label="Amount"
        value=""
        minLines={4}
        onChangeText={jest.fn()}
      />,
    );

    expect(heightOf(getByLabelText('Amount'))).toBeUndefined();
  });
});

describe('FormField align="auto"', () => {
  const alignOf = element => flatten(element.props.style).textAlign;

  it('reads left for Latin text', () => {
    const { getByLabelText } = render(
      <FormField
        label="Message"
        value="The AC is off"
        align="auto"
        onChangeText={jest.fn()}
      />,
    );

    expect(alignOf(getByLabelText('Message'))).toBe('left');
  });

  it('flips to the right for an Arabic complaint', () => {
    const { getByLabelText } = render(
      <FormField
        label="Message"
        value="المكيف لا يعمل"
        align="auto"
        onChangeText={jest.fn()}
      />,
    );

    expect(alignOf(getByLabelText('Message'))).toBe('right');
  });

  it('leaves explicit alignments alone', () => {
    const left = render(
      <FormField label="A" value="المكيف" onChangeText={jest.fn()} />,
    );
    const right = render(
      <FormField label="B" value="12" align="right" onChangeText={jest.fn()} />,
    );

    expect(alignOf(left.getByLabelText('A'))).toBe('left');
    expect(alignOf(right.getByLabelText('B'))).toBe('right');
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern Complaints in dark mode', () => {
  it('takes every colour from the palette', () => {
    const light = render(<Complaints />);
    expect(flatten(light.getByText('Complaint').props.style).color).toBe(
      COLORS.textPrimary,
    );

    mockScheme = 'dark';
    const dark = render(<Complaints />);
    expect(flatten(dark.getByText('Complaint').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    expect(
      flatten(dark.getByText('Complaint details').props.style).color,
    ).toBe(DARK_COLORS.textPrimary);
  });
});

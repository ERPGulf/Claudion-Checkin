import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  render,
  renderHook,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import base64 from 'base-64';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

let mockNewHomeEnabled = true;
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({
    enabled: mockNewHomeEnabled,
    hydrated: true,
    setEnabled: jest.fn(),
  }),
}));

// expo-camera is native; stub the surface the screen and the hook actually use.
let mockPermission = { granted: true, status: 'granted' };
const mockRequestPermission = jest.fn();
const mockScanFromURL = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: props => {
    const { View } = require('react-native');
    return <View testID="camera-view" {...props} />;
  },
  Camera: { scanFromURLAsync: (...args) => mockScanFromURL(...args) },
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));

const mockLaunchLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args) => mockLaunchLibrary(...args),
}));

// Ships untranspiled ESM and is not in transformIgnorePatterns.
jest.mock('expo-status-bar', () => ({
  StatusBar: props => {
    const { View } = require('react-native');
    return <View testID="status-bar" {...props} />;
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, Entypo: stub, MaterialCommunityIcons: stub };
});

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text>{`icon:${name}`}</Text>,
  };
});

const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
const mockGoBack = jest.fn();

/**
 * The modern scanner holds the camera back until the push animation is over, and
 * it learns that from the navigator's `transitionEnd`. Capturing the listeners
 * here is what lets a test render the screen mid-transition and then land it,
 * which is the sequence the whole fix is about.
 */
let transitionEndListeners = [];
const mockAddListener = jest.fn((event, callback) => {
  if (event === 'transitionEnd') transitionEndListeners.push(callback);
  return () => {
    transitionEndListeners = transitionEndListeners.filter(
      cb => cb !== callback,
    );
  };
});

let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    setOptions: mockSetOptions,
    goBack: mockGoBack,
    addListener: (...args) => mockAddListener(...args),
  }),
  useIsFocused: () => mockIsFocused,
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/* eslint-disable import/first */
import QrScan from '../screens/QrScan';
import useQrScanner from '../hooks/useQrScanner';
import ScanOverlay from '../components/QrScan/ScanOverlay';
import userReducer from '../redux/Slices/UserSlice';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

/** A well-formed provisioning payload, in the format the parser expects. */
const VALID_QR = base64.encode(
  [
    'Company:ERPGulf',
    'Employee_Code:HR-EMP-00011',
    'Full_Name:Aisha Seethara',
    'User_id:aisha@erpgulf.com',
    'API:erp.example.com',
    'App_key:abcdefgh',
    'Restrict Location:1',
    'Unrestricted Checkout Location:1',
  ].join(' '),
);

function makeStore() {
  return configureStore({ reducer: { user: userReducer } });
}

function withStore(children) {
  return <Provider store={makeStore()}>{children}</Provider>;
}

/** Fire the navigator event the screen waits on before starting the camera. */
function landTransition() {
  act(() => transitionEndListeners.forEach(callback => callback()));
}

/**
 * Renders the screen as it looks once it has arrived — the state every assertion
 * about the scanner is really about. Pass `{ settled: false }` to hold it in the
 * middle of the push instead.
 */
function renderScreen({ settled = true } = {}) {
  const store = makeStore();
  const utils = render(<QrScan />, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });

  if (settled) landTransition();

  return { store, ...utils };
}

function renderScannerHook() {
  const store = makeStore();
  return {
    store,
    ...renderHook(() => useQrScanner(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

// React Native polyfills a global `alert`; the node test environment does not,
// and the lifted parser reports both of its failure paths through it.
const mockAlert = jest.fn();
global.alert = mockAlert;

beforeEach(() => {
  mockScheme = 'light';
  mockNewHomeEnabled = true;
  mockPermission = { granted: true, status: 'granted' };
  mockIsFocused = true;
  transitionEndListeners = [];
  jest.clearAllMocks();
  AsyncStorage.clear();
});

/* =====================================================================
 * The lifted logic — unchanged from the classic screen
 * ================================================================== */

describe('useQrScanner', () => {
  it('requests the camera permission when it is not granted', () => {
    mockPermission = { granted: false, status: 'undetermined' };

    renderScannerHook();

    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it('does not re-request once the permission is granted', () => {
    renderScannerHook();

    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('asks once and stays asked, even while the answer keeps being no', () => {
    // The classic screen depends on the whole `permission` object and re-asks
    // whenever it is not granted. `useCameraPermissions` hands back a fresh object
    // every time, so that is a request loop running at render speed — and after a
    // hard denial the OS answers with no dialog, so nothing slows it down.
    mockPermission = { granted: false, status: 'denied' };

    const { rerender } = renderScannerHook();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i += 1) {
      mockPermission = { granted: false, status: 'denied' };
      act(() => rerender());
    }

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('parses a valid QR, persists every field and goes to login', async () => {
    const { result, store } = renderScannerHook();

    await act(async () => {
      await result.current.handleBarCodeScanned({ type: 'qr', data: VALID_QR });
    });

    // The same nine keys the classic screen wrote, with the same coercions.
    const stored = Object.fromEntries(
      await AsyncStorage.multiGet([
        'company',
        'employee_code',
        'full_name',
        'api_key',
        'app_key',
        'baseUrl',
        'photo',
        'restrict_location',
        'unrestricted_checkout_location',
      ]),
    );

    expect(stored).toMatchObject({
      company: 'ERPGulf',
      employee_code: 'HR-EMP-00011',
      full_name: 'Aisha Seethara',
      api_key: 'aisha@erpgulf.com',
      baseUrl: 'erp.example.com',
      // No `Photo` field in the payload → sanitizeNumber(undefined, 0).
      photo: '0',
      restrict_location: '1',
      unrestricted_checkout_location: '1',
    });

    // App_key padded to a `==` tail, exactly as before.
    expect(stored.app_key).toBe('abcdefgh==');

    // Redux got the same four values.
    const { user } = store.getState();
    expect(user.userDetails.employeeCode).toBe('HR-EMP-00011');
    expect(user.fullname).toBe('Aisha Seethara');

    expect(mockNavigate).toHaveBeenCalledWith('login');
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('rejects a payload missing a required field, without navigating', async () => {
    const { result } = renderScannerHook();
    const noCompany = base64.encode(
      'Employee_Code:HR-EMP-00011 API:erp.example.com App_key:abcd',
    );

    await act(async () => {
      await result.current.handleBarCodeScanned({ type: 'qr', data: noCompany });
    });

    expect(mockAlert).toHaveBeenCalledWith(
      'Invalid QR code. Please try again.',
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('alerts on undecodable data', async () => {
    const { result } = renderScannerHook();

    await act(async () => {
      await result.current.handleBarCodeScanned({ type: 'qr', data: '!!!!' });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalled();
  });

  it('flags `scanned` on a hit and clears it on scan again', async () => {
    const { result } = renderScannerHook();

    await act(async () => {
      await result.current.handleBarCodeScanned({ type: 'qr', data: '!!!!' });
    });
    expect(result.current.scanned).toBe(true);

    act(() => result.current.scanAgain());
    expect(result.current.scanned).toBe(false);
  });

  it('runs the gallery fallback through the same decoder and parser', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/qr.png' }],
    });
    mockScanFromURL.mockResolvedValue([{ data: VALID_QR }]);

    const { result } = renderScannerHook();

    await act(async () => {
      await result.current.pickImage();
    });

    // Same picker options as the classic screen.
    expect(mockLaunchLibrary).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    expect(mockScanFromURL).toHaveBeenCalledWith('file:///tmp/qr.png');
    expect(mockNavigate).toHaveBeenCalledWith('login');
  });

  it('does nothing when the picker is cancelled', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    const { result } = renderScannerHook();
    await act(async () => {
      await result.current.pickImage();
    });

    expect(mockScanFromURL).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('alerts when the chosen image holds no code', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/cat.png' }],
    });
    mockScanFromURL.mockRejectedValue(new Error('no code'));

    const { result } = renderScannerHook();
    await act(async () => {
      await result.current.pickImage();
    });

    expect(mockAlert).toHaveBeenCalledWith('No QR-CODE Found');
  });
});

/* =====================================================================
 * The toggle
 * ================================================================== */

describe('QR scanner container', () => {
  it('renders the modern scanner when the modern UI is on', () => {
    const { getByText, queryByText } = renderScreen();

    expect(getByText('Align the QR code inside the frame.')).toBeTruthy();
    expect(getByText('Choose from Photos')).toBeTruthy();
    expect(queryByText('SELECT FROM PHOTOS')).toBeNull();
  });

  it('renders the untouched classic scanner when the modern UI is off', () => {
    mockNewHomeEnabled = false;

    const { getByText, queryByText } = renderScreen();

    expect(getByText('SELECT FROM PHOTOS')).toBeTruthy();
    expect(queryByText('Align the QR code inside the frame.')).toBeNull();
  });
});

/* =====================================================================
 * Modern presentation
 * ================================================================== */

describe('modern QR scanner', () => {
  it('hands the camera the same scanner props as the classic screen', () => {
    const { getByTestId } = renderScreen();

    const camera = getByTestId('camera-view');
    expect(camera.props.barcodeScannerSettings).toEqual({
      barcodeTypes: ['qr'],
    });
    expect(camera.props.type).toBe('back');
    expect(typeof camera.props.onBarcodeScanned).toBe('function');
  });

  it('keeps the header title and a working back button, transparent over the preview', () => {
    renderScreen();

    const options = mockSetOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Scan QR Code');
    expect(options.headerShown).toBe(true);
    expect(options.headerTransparent).toBe(true);
    expect(options.headerStyle.backgroundColor).toBe('transparent');
    expect(options.headerTintColor).toBe('#FFFFFF');
  });

  it('shows only the photo action until a code is rejected', async () => {
    const { getByText, queryByText, getByTestId } = renderScreen();

    expect(queryByText('Scan again')).toBeNull();

    // A bad code leaves the user on the screen with `scanned` set.
    await act(async () => {
      await getByTestId('camera-view').props.onBarcodeScanned({
        type: 'qr',
        data: '!!!!',
      });
    });

    await waitFor(() => expect(getByText('Scan again')).toBeTruthy());
    expect(getByText('Choose from Photos')).toBeTruthy();
  });

  it('wires the photo action to the gallery picker', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Choose from Photos'));
    });

    expect(mockLaunchLibrary).toHaveBeenCalledTimes(1);
  });

  /* ---- Status bar: two platforms, two mechanisms, one crash to never repeat ---- */

  it('never sets statusBarStyle on iOS — react-native-screens throws on it here', () => {
    // Regression guard. `UIViewControllerBasedStatusBarAppearance` is false in
    // ios/ClaudionCheckin/Info.plist, so react-native-screens asserts and
    // redboxes the screen rather than ignoring the option. Do not "restore" this
    // without flipping that plist key, and note that flipping it cannot ship over
    // OTA while this crash can.
    const original = Platform.OS;
    Platform.OS = 'ios';
    try {
      renderScreen();
      const options = mockSetOptions.mock.calls[0][0];
      expect('statusBarStyle' in options).toBe(false);
    } finally {
      Platform.OS = original;
    }
  });

  it('sets statusBarStyle on Android, where the element is a no-op', () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      renderScreen();
      const options = mockSetOptions.mock.calls[0][0];
      expect(options.statusBarStyle).toBe('light');
    } finally {
      Platform.OS = original;
    }
  });

  it('mounts a light StatusBar element on every platform, for iOS to use', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('status-bar').props.style).toBe('light');
  });

  it('uses the shared button on a themed sheet, so the fill is legible', () => {
    const { getByLabelText } = renderScreen();

    const photos = flatten(getByLabelText('Choose from Photos').props.style);
    // `outline`: the card surface, not the near-black fill that would vanish
    // into the mask.
    expect(photos.backgroundColor).toBe(COLORS.cardBackground);
    expect(photos.minHeight).toBe(54);
  });
});

/* =====================================================================
 * Permission + loading states
 * ================================================================== */

describe('modern QR scanner states', () => {
  it('shows a subtle indicator while the permission is undetermined', () => {
    mockPermission = { granted: false, status: 'undetermined' };

    const { getByText, queryByTestId } = renderScreen();

    expect(getByText('Preparing camera…')).toBeTruthy();
    // No preview until the answer arrives.
    expect(queryByTestId('camera-view')).toBeNull();
  });

  /* ---- The blink: one chassis from mount to preview, never two screens ---- */

  it('waits on the same black chassis, instead of flashing a light screen', () => {
    // The permission answer is always at least a tick away, so whatever this
    // renders first is what every push shows first. It used to be a full-screen
    // `surfaceSecondary` — #F4F5F7 in light mode — replaced by the black scanner a
    // frame later.
    mockPermission = { granted: false, status: 'undetermined' };

    const { toJSON, getByText } = renderScreen();

    expect(flatten(toJSON().props.style).backgroundColor).toBe('#000000');
    // Not a stand-in screen: the real scanner chrome is already up behind the
    // spinner, so nothing about the layout changes when the preview arrives.
    expect(getByText('Align the QR code inside the frame.')).toBeTruthy();
    expect(getByText('Choose from Photos')).toBeTruthy();
  });

  it('sets the same header before and after the permission answer', () => {
    // The second half of the blink. Keying the chrome on "the preview is up" made
    // the bar go opaque-themed → transparent-white the moment the answer landed.
    mockPermission = { granted: false, status: 'undetermined' };
    renderScreen();
    const pending = mockSetOptions.mock.calls[0][0];

    jest.clearAllMocks();
    transitionEndListeners = [];
    mockPermission = { granted: true, status: 'granted' };
    renderScreen();
    const live = mockSetOptions.mock.calls[0][0];

    expect(pending.headerTransparent).toBe(live.headerTransparent);
    expect(pending.headerTintColor).toBe(live.headerTintColor);
    expect(pending.headerStyle.backgroundColor).toBe(
      live.headerStyle.backgroundColor,
    );
  });

  /* ---- The lag: never open a camera session during the push ---- */

  it('holds the camera back until the push animation has landed', () => {
    const { queryByTestId, getByText } = renderScreen({ settled: false });

    // Opening the session is native work on the UI thread; doing it here is what
    // made "Get Started" feel stuck.
    expect(queryByTestId('camera-view')).toBeNull();
    // The screen is complete regardless — only the picture is outstanding.
    expect(getByText('Align the QR code inside the frame.')).toBeTruthy();

    landTransition();

    expect(queryByTestId('camera-view')).toBeTruthy();
  });

  it('drops the camera when the screen is no longer focused', () => {
    // A good scan pushes `login` over this screen, which stays mounted beneath it
    // — with a live camera still decoding the QR code that is still in frame.
    mockIsFocused = false;

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('camera-view')).toBeNull();
  });

  it('offers the shared EmptyState when the permission is refused', () => {
    mockPermission = { granted: false, status: 'denied' };

    const { getByText, queryByTestId } = renderScreen();

    expect(getByText('Camera access needed')).toBeTruthy();
    expect(
      getByText(
        'Scanning your setup QR code needs the camera. Allow access, or turn it on for Claudion in your device Settings.',
      ),
    ).toBeTruthy();
    expect(queryByTestId('camera-view')).toBeNull();
  });

  it('retries with the same requestPermission the mount effect uses', () => {
    mockPermission = { granted: false, status: 'denied' };

    const { getByText } = renderScreen();

    // One call from the effect on mount…
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('Try again'));

    // …and the button re-runs that same function, nothing new.
    expect(mockRequestPermission).toHaveBeenCalledTimes(2);
  });

  it('gives the non-camera states the themed bar, not the transparent one', () => {
    mockPermission = { granted: false, status: 'denied' };

    renderScreen();

    const options = mockSetOptions.mock.calls[0][0];
    expect(options.headerTransparent).toBe(false);
    expect(options.headerStyle.backgroundColor).toBe(COLORS.surfaceSecondary);
    expect(options.headerTintColor).toBe(COLORS.textPrimary);
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern QR scanner in dark mode', () => {
  it('themes the action sheet and the button', () => {
    const light = renderScreen();
    expect(
      flatten(light.getByLabelText('Choose from Photos').props.style)
        .backgroundColor,
    ).toBe(COLORS.cardBackground);

    mockScheme = 'dark';
    const dark = renderScreen();
    expect(
      flatten(dark.getByLabelText('Choose from Photos').props.style)
        .backgroundColor,
    ).toBe(DARK_COLORS.cardBackground);
  });

  it('themes the permission state', () => {
    mockPermission = { granted: false, status: 'denied' };
    mockScheme = 'dark';

    const { getByText } = renderScreen();

    expect(flatten(getByText('Camera access needed').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
  });

  it('keeps the overlay fixed light-on-dark, because the backdrop is a camera', () => {
    const light = render(withStore(<ScanOverlay />));
    const lightHint = flatten(
      light.getByText('Align the QR code inside the frame.').props.style,
    );

    mockScheme = 'dark';
    const dark = render(withStore(<ScanOverlay />));
    const darkHint = flatten(
      dark.getByText('Align the QR code inside the frame.').props.style,
    );

    // Never tinted by the palette — a themed hint would be unreadable over a
    // picture in one mode or the other.
    expect(lightHint.color).toBe('#FFFFFF');
    expect(darkHint.color).toBe('#FFFFFF');
  });
});

/* =====================================================================
 * The overlay
 * ================================================================== */

describe('ScanOverlay', () => {
  it('never intercepts touches', () => {
    const { toJSON } = render(withStore(<ScanOverlay />));

    expect(toJSON().props.pointerEvents).toBe('none');
  });

  it('leaves the scan window clear, with a mask around it', () => {
    const { toJSON } = render(withStore(<ScanOverlay />));

    const panels = [];
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      const bg = flatten(node.props?.style).backgroundColor;
      if (bg) panels.push(bg);
      (node.children || []).forEach(walk);
    };
    walk(toJSON());

    // The mask is present…
    expect(panels).toContain('rgba(0,0,0,0.55)');
    // …and nothing paints over the window itself, so the decoder reads an
    // untouched preview.
    expect(panels.filter(bg => bg === 'rgba(0,0,0,0.55)').length).toBe(4);
  });

  it('draws four corner brackets on the frame', () => {
    const { toJSON } = render(withStore(<ScanOverlay />));

    const brackets = [];
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      const style = flatten(node.props?.style);
      const stroked =
        (style.borderTopWidth === 4 || style.borderBottomWidth === 4) &&
        (style.borderLeftWidth === 4 || style.borderRightWidth === 4);
      if (stroked) brackets.push(style);
      (node.children || []).forEach(walk);
    };
    walk(toJSON());

    expect(brackets).toHaveLength(4);
    // One rounded outer corner each, and animated rather than static.
    brackets.forEach(style => {
      expect(style.borderColor).toBe('#FFFFFF');
      expect(style.opacity).toBeDefined();
    });
  });
});

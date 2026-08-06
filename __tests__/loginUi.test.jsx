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

let mockReduceMotion = false;
jest.mock('../hooks/useReducedMotion', () => ({
  __esModule: true,
  default: () => mockReduceMotion,
}));

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: props => <View {...props} /> };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    Ionicons: stub,
    Entypo: stub,
    MaterialCommunityIcons: stub,
  };
});

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text>{`icon:${name}`}</Text>,
  };
});

const mockToastShow = jest.fn();
jest.mock('react-native-toast-message/lib/src/Toast', () => ({
  Toast: { show: (...args) => mockToastShow(...args) },
}));

const mockGenerateToken = jest.fn();
jest.mock('../services/api', () => ({
  generateToken: (...args) => mockGenerateToken(...args),
}));

const mockGetNotifications = jest.fn(() => Promise.resolve([]));
jest.mock('../services/api/notification.service', () => ({
  getNotifications: (...args) => mockGetNotifications(...args),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/* eslint-disable import/first */
import Login from '../screens/Login';
import useLogin from '../hooks/useLogin';
import userReducer from '../redux/Slices/UserSlice';
import authReducer from '../redux/Slices/AuthSlice';
import notificationReducer from '../redux/Slices/notificationSlice';
import { COLORS, DARK_COLORS, BUILD_TAG } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

/** Walks the rendered tree collecting every node's flattened style. */
function collectStyles(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props?.style) out.push(flatten(node.props.style));
  (node.children || []).forEach(child => collectStyles(child, out));
  return out;
}

const FULL_NAME = 'Aisha Seethara';

function makeStore(preloadedState) {
  return configureStore({
    reducer: {
      user: userReducer,
      userAuth: authReducer,
      notification: notificationReducer,
    },
    preloadedState,
  });
}

function renderScreen() {
  const store = makeStore();
  store.dispatch({ type: 'user/setFullname', payload: FULL_NAME });

  return {
    store,
    ...render(<Login />, {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

function renderLoginHook() {
  const store = makeStore();
  store.dispatch({ type: 'user/setFullname', payload: FULL_NAME });

  return {
    store,
    ...renderHook(() => useLogin(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

/** The three keys the QR scan provisions, which login refuses to run without. */
async function provision() {
  await AsyncStorage.multiSet([
    ['api_key', 'aisha@erpgulf.com'],
    ['app_key', 'abcdefgh=='],
    ['baseUrl', 'erp.example.com'],
  ]);
}

beforeEach(async () => {
  mockScheme = 'light';
  mockNewHomeEnabled = true;
  mockReduceMotion = false;
  jest.clearAllMocks();
  mockGetNotifications.mockResolvedValue([]);
  mockGenerateToken.mockResolvedValue({ access_token: 'tok_123' });
  await AsyncStorage.clear();
});

/* =====================================================================
 * The lifted logic — unchanged from the classic screen
 * ================================================================== */

describe('useLogin', () => {
  it('refuses to call the API before a QR code has been scanned', async () => {
    const { result } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text1: 'QR code not scanned',
        text2: 'Please scan QR code first',
      }),
    );
    // The guard returns rather than falling through to `finally`, but either way
    // the button has to come back.
    expect(result.current.isLoading).toBe(false);
  });

  it('exchanges the password for a token and signs in', async () => {
    await provision();
    const { result, store } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    // Same three credentials, same shape, same key names as the classic screen.
    expect(mockGenerateToken).toHaveBeenCalledWith({
      api_key: 'aisha@erpgulf.com',
      app_key: 'abcdefgh==',
      api_secret: 'hunter2',
    });

    expect(store.getState().userAuth.isLoggedIn).toBe(true);
    expect(store.getState().userAuth.token).toBe('tok_123');
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text1: 'Login successful' }),
    );
  });

  it('persists the employee code as `employee_id` when there is one', async () => {
    await provision();
    const store = makeStore();
    store.dispatch({
      type: 'user/setEmployeeCode',
      payload: 'HR-EMP-00011',
    });

    const { result } = renderHook(() => useLogin(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(await AsyncStorage.getItem('employee_id')).toBe('HR-EMP-00011');
  });

  it('syncs the unread count, counting only unread notifications', async () => {
    await provision();
    await AsyncStorage.setItem('employee_id', 'HR-EMP-00011');
    mockGetNotifications.mockResolvedValue([
      { read: 0 },
      { read: 1 },
      { read: 0 },
    ]);

    const { result, store } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(mockGetNotifications).toHaveBeenCalledWith('HR-EMP-00011');
    expect(store.getState().notification.unreadCount).toBe(2);
  });

  it('still signs in when the notification fetch fails', async () => {
    // The classic screen swallows this on purpose: an unread badge is not worth
    // failing an authentication that already succeeded.
    await provision();
    await AsyncStorage.setItem('employee_id', 'HR-EMP-00011');
    mockGetNotifications.mockRejectedValue(new Error('offline'));

    const { result, store } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(store.getState().userAuth.isLoggedIn).toBe(true);
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('treats a missing access token as a failure', async () => {
    await provision();
    mockGenerateToken.mockResolvedValue({});

    const { result, store } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(store.getState().userAuth.isLoggedIn).toBe(false);
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('reports a rejected password through the shared error mapper', async () => {
    await provision();
    mockGenerateToken.mockRejectedValue({
      response: { status: 401, data: {} },
    });

    const { result } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('wrong');
    });

    const [toast] = mockToastShow.mock.calls.at(-1);
    expect(toast.type).toBe('error');
    expect(toast.visibilityTime).toBe(4000);
    expect(typeof toast.text1).toBe('string');
    expect(toast.text1.length).toBeGreaterThan(0);
  });

  it('clears the loading flag whether it succeeds or fails', async () => {
    await provision();
    mockGenerateToken.mockRejectedValue(new Error('boom'));

    const { result } = renderLoginHook();

    await act(async () => {
      await result.current.handleLogin('hunter2');
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the classic password rules exactly', async () => {
    const { result } = renderLoginHook();
    const { loginSchema } = result.current;

    // `required` only fires for a missing value: Yup checks `min` first, so an
    // empty box reports "Too short!". That is what the classic screen does too,
    // and this pins it rather than quietly improving it.
    await expect(loginSchema.validate({})).rejects.toThrow(
      'Please enter your password.',
    );
    await expect(loginSchema.validate({ password: '' })).rejects.toThrow(
      'Too short!',
    );
    await expect(loginSchema.validate({ password: 'abcd' })).rejects.toThrow(
      'Too short!',
    );
    await expect(
      loginSchema.validate({ password: 'a'.repeat(25) }),
    ).rejects.toThrow('Too long!');
    await expect(
      loginSchema.validate({ password: 'hunter2' }),
    ).resolves.toBeTruthy();

    expect(result.current.initialValues).toEqual({ password: '' });
  });
});

/* =====================================================================
 * The toggle
 * ================================================================== */

describe('Login container', () => {
  it('renders the modern login when the modern UI is on', () => {
    const { getByText, queryByText } = renderScreen();

    expect(getByText('Welcome back')).toBeTruthy();
    expect(getByText('Scan QR Code')).toBeTruthy();
    // The classic hero's copy is gone.
    expect(queryByText('Hey,')).toBeNull();
    expect(queryByText('Rescan QR Code')).toBeNull();
  });

  it('renders the untouched classic login when the modern UI is off', () => {
    mockNewHomeEnabled = false;

    const { getByText, queryByText } = renderScreen();

    expect(getByText('Hey,')).toBeTruthy();
    expect(getByText('Rescan QR Code')).toBeTruthy();
    expect(queryByText('Welcome back')).toBeNull();
  });
});

/* =====================================================================
 * Modern presentation
 * ================================================================== */

describe('modern Login', () => {
  it('greets the signed-in employee by name, as one screen-reader item', () => {
    const { getByLabelText, getByText } = renderScreen();

    expect(getByText('Welcome back')).toBeTruthy();
    expect(getByText(FULL_NAME)).toBeTruthy();
    // One stop, not three.
    expect(
      getByLabelText(
        `Welcome back, ${FULL_NAME}. Continue securely to your workspace.`,
      ),
    ).toBeTruthy();
  });

  it('keeps the branding small enough not to outrank the form', () => {
    const { getByLabelText } = renderScreen();

    const mark = flatten(getByLabelText('Claudion').props.style);
    // The welcome screen's hero mark is 330 wide; this is a signature.
    expect(mark.width).toBeLessThanOrEqual(140);
  });

  it('masks the password and reveals it on the shared eye toggle', () => {
    const { getByLabelText, getByText } = renderScreen();

    const input = getByLabelText('Password');
    expect(input.props.secureTextEntry).toBe(true);
    expect(getByText('icon:eye')).toBeTruthy();

    fireEvent.press(getByLabelText('Show password'));

    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(getByText('icon:eye-off')).toBeTruthy();

    fireEvent.press(getByLabelText('Hide password'));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('surfaces the validation message once the field has been touched', async () => {
    const { getByLabelText, queryByText } = renderScreen();

    expect(queryByText('Too short!')).toBeNull();

    const input = getByLabelText('Password');
    fireEvent.changeText(input, 'abc');
    fireEvent(input, 'blur');

    await waitFor(() => expect(queryByText('Too short!')).toBeTruthy());
  });

  it('holds the login button closed until the password validates', async () => {
    const { getByLabelText } = renderScreen();

    // Formik starts `isValid` true on an untouched form, so the guard that
    // matters is the one after a bad value has been entered.
    const input = getByLabelText('Password');
    fireEvent.changeText(input, 'abc');
    fireEvent(input, 'blur');

    await waitFor(() =>
      expect(getByLabelText('Login').props.accessibilityState.disabled).toBe(
        true,
      ),
    );

    fireEvent.changeText(input, 'hunter2');

    await waitFor(() =>
      expect(getByLabelText('Login').props.accessibilityState.disabled).toBe(
        false,
      ),
    );
  });

  it('submits the typed password through the lifted flow', async () => {
    await provision();
    const { getByLabelText } = renderScreen();

    fireEvent.changeText(getByLabelText('Password'), 'hunter2');

    await act(async () => {
      fireEvent.press(getByLabelText('Login'));
    });

    await waitFor(() =>
      expect(mockGenerateToken).toHaveBeenCalledWith(
        expect.objectContaining({ api_secret: 'hunter2' }),
      ),
    );
  });

  it('sends the QR button to the scanner, and nowhere else', () => {
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Scan QR Code'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  });

  it('makes Login the primary and the QR route plainly secondary', () => {
    const { getByLabelText } = renderScreen();

    const login = flatten(getByLabelText('Login').props.style);
    const qr = flatten(getByLabelText('Scan QR Code').props.style);

    // Accent fill against the card surface with a hairline: one reads as the
    // action, the other as the alternative. The classic screen gave both a
    // full-weight brand-coloured treatment at the same height.
    expect(login.backgroundColor).toBe(COLORS.accentFill);
    expect(qr.backgroundColor).toBe(COLORS.cardBackground);
    expect(qr.borderWidth).toBe(1);
    expect(login.minHeight).toBe(qr.minHeight);
  });

  it('keeps the build stamp', () => {
    const { getByText } = renderScreen();

    expect(getByText(BUILD_TAG)).toBeTruthy();
  });

  it('scrolls rather than clips, so large type and the keyboard have room', () => {
    const { UNSAFE_getByType } = renderScreen();
    const { ScrollView } = require('react-native');

    const scroller = UNSAFE_getByType(ScrollView);
    expect(flatten(scroller.props.contentContainerStyle).flexGrow).toBe(1);
    // Otherwise the first tap on Login only dismisses the keyboard.
    expect(scroller.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('replaces the 260pt slab with a card on the shared surface tokens', () => {
    const { toJSON } = renderScreen();

    const surfaces = collectStyles(toJSON());

    // The shared <Card>: card surface, hairline, the standard radius.
    expect(
      surfaces.some(
        s =>
          s.backgroundColor === COLORS.cardBackground &&
          s.borderColor === COLORS.cardBorder,
      ),
    ).toBe(true);

    // And no near-black slab anywhere — the classic hero's `COLORS.primary`
    // block is the single thing this redesign exists to remove.
    expect(surfaces.map(s => s.backgroundColor)).not.toContain(COLORS.primary);
  });

  it('groups the greeting for screen readers without greying the card', () => {
    // Measured on device: `accessible` on a <Card> flattens its white background
    // to #ECECEC on Android — darker than the page, so the card reads as a grey
    // slab. The grouping has to live on an inner node that paints nothing.
    const { getByLabelText } = renderScreen();

    const group = flatten(
      getByLabelText(
        `Welcome back, ${FULL_NAME}. Continue securely to your workspace.`,
      ).props.style,
    );

    expect(group.backgroundColor).toBeUndefined();
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern Login in dark mode', () => {
  it('takes card, text and field colours from the dark palette', () => {
    const light = renderScreen();
    expect(
      flatten(light.getByText(FULL_NAME).props.style).color,
    ).toBe(COLORS.textPrimary);

    mockScheme = 'dark';
    const dark = renderScreen();
    expect(flatten(dark.getByText(FULL_NAME).props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
  });

  it('inverts the primary fill rather than keeping a light-mode block', () => {
    mockScheme = 'dark';
    const { getByLabelText, toJSON } = renderScreen();

    // The accent is deliberately the same in both palettes — a brand colour that
    // changed hue between themes would stop reading as the brand.
    expect(flatten(getByLabelText('Login').props.style).backgroundColor).toBe(
      DARK_COLORS.accentFill,
    );

    // And nothing on the page is still painted with a light-mode surface.
    const fills = collectStyles(toJSON()).map(s => s.backgroundColor);
    expect(fills).not.toContain(COLORS.cardBackground);
  });
});

/* =====================================================================
 * Motion
 * ================================================================== */

describe('modern Login entrance', () => {
  it('settles to an interactive screen', async () => {
    jest.useFakeTimers();
    await provision();
    const { getByLabelText } = renderScreen();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    fireEvent.press(getByLabelText('Scan QR Code'));
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');

    jest.useRealTimers();
  });

  it('skips straight to the settled state under reduce motion', () => {
    mockReduceMotion = true;

    const { getByText, getByLabelText } = renderScreen();

    expect(getByText('Welcome back')).toBeTruthy();
    fireEvent.press(getByLabelText('Scan QR Code'));
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  });
});

/* =====================================================================
 * The shared field, extended — every existing caller must be unaffected
 * ================================================================== */

describe('FormField password support', () => {
  /* eslint-disable global-require */
  const FormField = require('../components/common/FormField').default;
  /* eslint-enable global-require */

  it('stays a plain visible field when nothing is opted into', () => {
    const { getByLabelText, queryByLabelText } = render(
      <FormField label="Purpose" value="" onChangeText={jest.fn()} />,
    );

    const input = getByLabelText('Purpose');
    // `undefined`, not `false` — the prop is simply not in play for the fields
    // that were here before.
    expect(input.props.secureTextEntry).toBeFalsy();
    expect(input.props.editable).toBe(true);
    expect(queryByLabelText('Show password')).toBeNull();
  });

  it('shows an error message and turns the border red with it', () => {
    const { getByText, toJSON } = render(
      <FormField
        label="Purpose"
        value=""
        onChangeText={jest.fn()}
        errorText="Required"
      />,
    );

    expect(getByText('Required')).toBeTruthy();
    // A message that no screen reader announces is decoration.
    expect(getByText('Required').props.accessibilityLiveRegion).toBe('polite');
    // `errorText` implies `invalid`; a caller should not have to say it twice.
    expect(
      collectStyles(toJSON()).some(s => s.borderColor === COLORS.errorBorder),
    ).toBe(true);
  });

  it('stops editing and drops the focus lift when disabled', () => {
    const { getByLabelText } = render(
      <FormField label="Purpose" value="" onChangeText={jest.fn()} disabled />,
    );

    expect(getByLabelText('Purpose').props.editable).toBe(false);
  });

  it.each(['android', 'ios'])(
    'never shadows a focused field on %s — it blurs the input',
    platform => {
      // Measured on both devices. Adding a shadow to the container of a focused
      // input blurs it the instant it focuses, so the keyboard opens and shuts
      // and nothing can be typed:
      //   Android — `onStartInput` (password IME) then `onFinishInputView` in the
      //             same beat; the classic screen's plain field held focus.
      //   iOS     — an autoFocused field rendered already blurred and errored,
      //             with no caret; dropping the shadow gave it one.
      // Gating this to iOS was the first attempt and was only half a fix, hence
      // both platforms are pinned here.
      const original = Platform.OS;
      Platform.OS = platform;
      try {
        const { getByLabelText, toJSON } = render(
          <FormField label="Purpose" value="" onChangeText={jest.fn()} />,
        );

        fireEvent(getByLabelText('Purpose'), 'focus');

        const styles = collectStyles(toJSON());
        expect(styles.some(s => s.elevation)).toBe(false);
        expect(styles.some(s => s.shadowOpacity > 0)).toBe(false);
      } finally {
        Platform.OS = original;
      }
    },
  );

  it('still signals focus, through the border and the fill', () => {
    // The two affordances that survive. If both of these ever go, the field has
    // no focus state at all and the shadow removal has gone too far.
    const { getByLabelText, toJSON } = render(
      <FormField label="Purpose" value="" onChangeText={jest.fn()} />,
    );

    const before = collectStyles(toJSON());
    expect(
      before.some(s => s.borderColor === COLORS.cardBorder),
    ).toBe(true);

    fireEvent(getByLabelText('Purpose'), 'focus');

    const after = collectStyles(toJSON());
    expect(after.some(s => s.borderColor === COLORS.textPrimary)).toBe(true);
    expect(after.some(s => s.backgroundColor === COLORS.cardBackground)).toBe(
      true,
    );
  });

  it('still calls the caller\'s onBlur, which is what marks a field touched', () => {
    const onBlur = jest.fn();
    const { getByLabelText } = render(
      <FormField
        label="Purpose"
        value=""
        onChangeText={jest.fn()}
        onBlur={onBlur}
      />,
    );

    fireEvent(getByLabelText('Purpose'), 'blur');

    expect(onBlur).toHaveBeenCalled();
  });
});

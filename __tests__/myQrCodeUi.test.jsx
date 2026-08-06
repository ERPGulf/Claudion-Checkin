import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
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

// The service reaches the network through apiClient → expo-location, which this
// jest config does not transform.
jest.mock('../services/api/qr.service', () => ({
  getQrCode: jest.fn(),
}));

/* eslint-disable import/first */
import MyQrCode from '../screens/MyQrCode';
import useQrCode from '../hooks/useQrCode';
import QrPlate, { QR_SIZE } from '../components/MyQrCode/QrPlate';
import QrBadgeCard from '../components/MyQrCode/QrBadgeCard';
import { getQrCode } from '../services/api/qr.service';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

const QR = {
  employee: 'HR-EMP-00011',
  imageUrl: 'https://erp.example.com/files/qr-hr-emp-00011.png',
};

/** Minimal user slice: only the two fields the screen reads. */
function makeStore({ employeeCode = 'HR-EMP-00011', fullname = 'Aisha Seethara' } = {}) {
  return configureStore({
    reducer: {
      user: (state = { userDetails: { employeeCode }, fullname }) => state,
    },
  });
}

function renderScreen(userOptions) {
  const store = makeStore(userOptions);

  return {
    store,
    ...render(<MyQrCode />, {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

function renderQrHook(userOptions) {
  const store = makeStore(userOptions);

  return renderHook(() => useQrCode(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
}

beforeEach(() => {
  mockScheme = 'light';
  jest.clearAllMocks();
  getQrCode.mockResolvedValue(QR);
});

/* =====================================================================
 * The fetch — lifted from the classic screen, unchanged
 * ================================================================== */

describe('useQrCode', () => {
  it('asks for the QR once, with the employee code from Redux', async () => {
    const { result } = renderQrHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getQrCode).toHaveBeenCalledTimes(1);
    expect(getQrCode).toHaveBeenCalledWith('HR-EMP-00011');
  });

  it('surfaces the server values untouched', async () => {
    const { result } = renderQrHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Nothing re-encoded, re-derived or defaulted: the url and the id are
    // exactly what the endpoint returned.
    expect(result.current.imageUrl).toBe(QR.imageUrl);
    expect(result.current.employee).toBe(QR.employee);
    expect(result.current.error).toBe(false);
  });

  it('reports an error instead of swallowing a failure', async () => {
    getQrCode.mockRejectedValue(new Error('offline'));

    const { result } = renderQrHook();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.imageUrl).toBeNull();
  });

  it('treats a response with no image as unusable', async () => {
    getQrCode.mockResolvedValue({ employee: 'HR-EMP-00011', imageUrl: null });

    const { result } = renderQrHook();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
  });

  it('stops loading when there is no employee code', async () => {
    // The classic effect returned before its `finally`, so this case span the
    // spinner forever.
    const { result } = renderQrHook({ employeeCode: null });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getQrCode).not.toHaveBeenCalled();
    expect(result.current.error).toBe(true);
  });

  it('re-runs the identical call on retry', async () => {
    getQrCode.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderQrHook();
    await waitFor(() => expect(result.current.error).toBe(true));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.error).toBe(false));
    expect(getQrCode).toHaveBeenCalledTimes(2);
    expect(getQrCode).toHaveBeenLastCalledWith('HR-EMP-00011');
    expect(result.current.imageUrl).toBe(QR.imageUrl);
  });
});

/* =====================================================================
 * Screen presentation
 * ================================================================== */

describe('modern My QR Code screen', () => {
  it('uses the shared modern header and adds a subtitle', async () => {
    const { getByText } = renderScreen();

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('My QR Code');
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe('function');

    const subtitle = getByText(
      'Present this QR code when you are asked to identify yourself or to record attendance.',
    );
    expect(subtitle.props.numberOfLines).toBe(2);

    await waitFor(() => expect(getQrCode).toHaveBeenCalled());
  });

  it('shows a skeleton while the code is loading', async () => {
    const { getByLabelText } = renderScreen();

    expect(getByLabelText('Loading your QR code')).toBeTruthy();

    await waitFor(() => expect(getQrCode).toHaveBeenCalled());
  });

  it('renders the badge with the employee id and name', async () => {
    const { getByText, getByLabelText } = renderScreen();

    await waitFor(() => expect(getByText('HR-EMP-00011')).toBeTruthy());

    expect(getByText('Aisha Seethara')).toBeTruthy();
    expect(
      getByLabelText('Employee badge for Aisha Seethara, HR-EMP-00011'),
    ).toBeTruthy();
  });

  it('explains what the code is for, without inventing services', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('About this QR code')).toBeTruthy());
    expect(
      getByText(
        'It uniquely identifies your employee profile and may be used for attendance, identity verification or company services.',
      ),
    ).toBeTruthy();
  });

  it('keeps the branding link, muted and at the end', async () => {
    jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());

    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText('ERPGulf.com')).toBeTruthy());

    // Muted, not the classic green heading.
    expect(flatten(getByText('ERPGulf.com').props.style).color).toBe(
      COLORS.textMuted,
    );

    const link = getByLabelText('Open ERPGulf.com');
    expect(flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44);

    fireEvent.press(link);
    expect(Linking.openURL).toHaveBeenCalledWith('https://erpgulf.com');

    Linking.openURL.mockRestore();
  });

  it('offers the shared error state with a retry when the fetch fails', async () => {
    getQrCode.mockRejectedValue(new Error('offline'));

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Unable to load QR code')).toBeTruthy());
    expect(
      getByText(
        'Please try again later. If it keeps failing, contact your HR administrator.',
      ),
    ).toBeTruthy();

    getQrCode.mockResolvedValue(QR);
    await act(async () => {
      fireEvent.press(getByText('Try again'));
    });

    await waitFor(() => expect(getByText('HR-EMP-00011')).toBeTruthy());
  });

  it('offers no share, download or copy action — the app has none', async () => {
    const { queryByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText('HR-EMP-00011')).toBeTruthy());

    ['Share', 'Download', 'Copy employee ID'].forEach(label =>
      expect(queryByLabelText(label)).toBeNull(),
    );
  });
});

/* =====================================================================
 * The code itself — never inverted, never resized
 * ================================================================== */

describe('QrPlate', () => {
  const plate = () =>
    render(<QrPlate uri={QR.imageUrl} employee={QR.employee} />);

  it('renders the server image at the classic size and fit', () => {
    const { UNSAFE_getByType } = plate();
    const { Image } = require('react-native');

    const image = UNSAFE_getByType(Image);
    expect(image.props.source).toEqual({ uri: QR.imageUrl });
    expect(flatten(image.props.style)).toMatchObject({
      width: QR_SIZE,
      height: QR_SIZE,
    });
    expect(image.props.resizeMode).toBe('contain');
  });

  it('labels the code for a screen reader', () => {
    const { getByLabelText } = plate();
    expect(getByLabelText('QR code for employee HR-EMP-00011')).toBeTruthy();
  });

  it('keeps a white plate and a quiet zone in dark mode, so it stays scannable', () => {
    const light = plate();
    const lightPlate = flatten(light.toJSON().props.style);

    mockScheme = 'dark';
    const dark = plate();
    const darkPlate = flatten(dark.toJSON().props.style);

    expect(lightPlate.backgroundColor).toBe('#FFFFFF');
    // Never inverted or tinted with the palette.
    expect(darkPlate.backgroundColor).toBe('#FFFFFF');
    expect(darkPlate.padding).toBeGreaterThan(0);
  });

  it('does not re-render for an unrelated prop change', () => {
    // Memoised on its props: re-decoding the image would flash the one thing
    // the user opened the screen to show.
    const { UNSAFE_getByType, rerender } = plate();
    const { Image } = require('react-native');

    const first = UNSAFE_getByType(Image);
    rerender(<QrPlate uri={QR.imageUrl} employee={QR.employee} />);

    expect(UNSAFE_getByType(Image).props.source).toEqual(first.props.source);
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern My QR Code in dark mode', () => {
  const badge = () => (
    <QrBadgeCard
      imageUrl={QR.imageUrl}
      employee={QR.employee}
      fullname="Aisha Seethara"
    />
  );

  it('takes its chrome from the palette while the code stays untouched', () => {
    const light = render(badge());
    expect(flatten(light.getByText('Aisha Seethara').props.style).color).toBe(
      COLORS.textPrimary,
    );

    mockScheme = 'dark';
    const dark = render(badge());
    expect(flatten(dark.getByText('Aisha Seethara').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    expect(flatten(dark.getByText('HR-EMP-00011').props.style).color).toBe(
      DARK_COLORS.textSecondary,
    );
  });

  it('falls back to a dash when the server sent no id', () => {
    const { getByText } = render(
      <QrBadgeCard imageUrl={QR.imageUrl} employee={null} fullname="Aisha" />,
    );

    expect(getByText('—')).toBeTruthy();
  });
});

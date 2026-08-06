import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

// Dark mode is gated on the Modern UI toggle, so the toast can only go dark
// when that is on — the same rule every other themed surface follows.
let mockModernUi = true;
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: mockModernUi, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub };
});

/* eslint-disable import/first */
import { toastConfig, TOAST_TYPES } from '../Toast/Config';
import ToastBanner from '../Toast/ToastBanner';
import { COLORS, DARK_COLORS, TYPO } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

/**
 * Renders a type through the config exactly the way the library does — by
 * calling `config[type](params)` with the full params object it passes.
 */
const renderType = (type, params = {}) =>
  render(
    toastConfig[type]({
      position: 'top',
      type,
      isVisible: true,
      text1: 'Title',
      text2: 'Message',
      show: jest.fn(),
      hide: jest.fn(),
      ...params,
    }),
  );

beforeEach(() => {
  mockScheme = 'light';
  mockModernUi = true;
});

/* =====================================================================
 * The API contract — every existing Toast.show() must keep working
 * ================================================================== */

describe('toastConfig contract', () => {
  it('still exposes exactly the five types the app calls', () => {
    // Adding a key is fine; losing one breaks a live `Toast.show()` call.
    ['success', 'error', 'info', 'notificationToast', 'announcementToast'].forEach(
      type => expect(typeof toastConfig[type]).toBe('function'),
    );
  });

  it('renders text1 and text2 for every type', () => {
    Object.keys(TOAST_TYPES).forEach(type => {
      const { getByText } = renderType(type);
      expect(getByText('Title')).toBeTruthy();
      expect(getByText('Message')).toBeTruthy();
    });
  });

  it('renders a title-only toast, as several call sites use', () => {
    // e.g. AttendanceCamera: Toast.show({ type: 'error', text1: '…' })
    const { getByText, queryByText } = renderType('error', { text2: undefined });

    expect(getByText('Title')).toBeTruthy();
    expect(queryByText('Message')).toBeNull();
  });

  it('keeps the whole banner tappable when onPress is supplied', () => {
    // The FCM foreground toast relies on this to open Notifications.
    const onPress = jest.fn();
    const { getByLabelText } = renderType('notificationToast', { onPress });

    fireEvent.press(getByLabelText('Title. Message'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not pressable when no onPress was given', () => {
    const { getByLabelText } = renderType('success');

    expect(getByLabelText('Title. Message').props.accessibilityRole).toBe(
      'alert',
    );
  });

  it('still honours caller-supplied text styles', () => {
    const { getByText } = renderType('info', {
      text1Style: { fontSize: 30 },
      text2Style: { fontSize: 9 },
    });

    expect(flatten(getByText('Title').props.style).fontSize).toBe(30);
    expect(flatten(getByText('Message').props.style).fontSize).toBe(9);
  });

  it('dismisses through the library hide callback', () => {
    const hide = jest.fn();
    const { getByLabelText } = renderType('success', { hide });

    fireEvent.press(getByLabelText('Dismiss'));
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('drops the close button when the host gives no hide', () => {
    const { queryByLabelText } = renderType('success', { hide: undefined });

    expect(queryByLabelText('Dismiss')).toBeNull();
  });
});

/* =====================================================================
 * Distinct identities
 * ================================================================== */

describe('type identities', () => {
  const glyphs = {
    success: 'icon:checkmark-circle',
    error: 'icon:close-circle',
    info: 'icon:information-circle',
    notificationToast: 'icon:notifications',
    announcementToast: 'icon:megaphone',
  };

  it('gives every type its own glyph', () => {
    Object.entries(glyphs).forEach(([type, glyph]) => {
      expect(renderType(type).getByText(glyph)).toBeTruthy();
    });
  });

  it('gives every type its own tinted surface', () => {
    const surfaces = Object.keys(TOAST_TYPES).map(type =>
      flatten(renderType(type).getByLabelText('Title. Message').props.style)
        .backgroundColor,
    );

    // Five types, five distinct surfaces — no two share a colour.
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it('tints, rather than saturating: the surface is the palette token', () => {
    const { getByLabelText, getByText } = renderType('success');
    const style = flatten(getByLabelText('Title. Message').props.style);

    expect(style.backgroundColor).toBe(COLORS.successSurface);
    expect(style.borderColor).toBe(COLORS.successBorder);
    expect(flatten(getByText('Title').props.style).color).toBe(
      COLORS.successText,
    );
    // The old config painted a solid #22c55e block with white centred text.
    expect(style.backgroundColor).not.toBe('#22c55e');
  });
});

/* =====================================================================
 * Layout, typography and wrapping
 * ================================================================== */

describe('banner layout', () => {
  it('lays out horizontally and left-aligned, not centred', () => {
    const { getByLabelText, getByText } = renderType('info');

    expect(flatten(getByLabelText('Title. Message').props.style).flexDirection).toBe(
      'row',
    );
    expect(flatten(getByText('Title').props.style).textAlign).toBe('left');
    expect(flatten(getByText('Message').props.style).textAlign).toBe('left');
  });

  it('follows the script of the text for RTL', () => {
    const { getByText } = renderType('info', {
      text1: 'تم تسجيل الحضور',
      text2: 'شكرا لك',
    });

    expect(flatten(getByText('تم تسجيل الحضور').props.style).textAlign).toBe(
      'right',
    );
  });

  it('uses the type scale rather than 20pt centred text', () => {
    const { getByText } = renderType('success');

    expect(flatten(getByText('Title').props.style).fontSize).toBe(
      TYPO.title3.fontSize,
    );
    expect(flatten(getByText('Message').props.style).fontSize).toBe(
      TYPO.subhead.fontSize,
    );
  });

  it('lets a long message wrap instead of clipping it', () => {
    const long =
      'Your expense claim for 1,250.00 was approved by your manager and will be settled with this month payroll run.';
    const { getByText, getByLabelText } = renderType('success', { text2: long });

    // No fixed height on the banner and no line cap on the text — the old
    // config pinned the banner to 60pt and cut the second line off.
    const style = flatten(getByLabelText(`Title. ${long}`).props.style);
    expect(style.height).toBeUndefined();
    expect(getByText(long).props.numberOfLines).toBeUndefined();
  });

  it('rounds the corners to the shared radius', () => {
    const { getByLabelText } = renderType('info');
    const style = flatten(getByLabelText('Title. Message').props.style);

    expect(style.borderRadius).toBeGreaterThanOrEqual(16);
    expect(style.borderRadius).toBeLessThanOrEqual(18);
  });
});

/* =====================================================================
 * Accessibility
 * ================================================================== */

describe('accessibility', () => {
  it('announces itself as a live region with both lines', () => {
    const { getByLabelText } = renderType('error');
    const banner = getByLabelText('Title. Message');

    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(banner.props.accessibilityRole).toBe('alert');
  });

  it('labels the icon-only close button', () => {
    const { getByLabelText } = renderType('info');
    expect(getByLabelText('Dismiss')).toBeTruthy();
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('dark mode', () => {
  it('takes both palettes from the theme, never a hardcoded colour', () => {
    const light = renderType('error');
    expect(
      flatten(light.getByLabelText('Title. Message').props.style).backgroundColor,
    ).toBe(COLORS.errorSurface);

    mockScheme = 'dark';
    const dark = renderType('error');
    const style = flatten(dark.getByLabelText('Title. Message').props.style);

    expect(style.backgroundColor).toBe(DARK_COLORS.errorSurface);
    expect(style.borderColor).toBe(DARK_COLORS.errorBorder);
    expect(
      flatten(dark.getByText('Title').props.style).color,
    ).toBe(DARK_COLORS.errorText);
  });

  it('drops the shadow in dark mode, where it would be invisible', () => {
    const light = flatten(
      renderType('info').getByLabelText('Title. Message').props.style,
    );
    expect(light.shadowColor).toBeDefined();

    mockScheme = 'dark';
    const dark = flatten(
      renderType('info').getByLabelText('Title. Message').props.style,
    );
    expect(dark.shadowColor).toBeUndefined();
  });

  it('stays light while the Modern UI toggle is off', () => {
    mockScheme = 'dark';
    mockModernUi = false;

    const { getByLabelText } = renderType('info');

    expect(
      flatten(getByLabelText('Title. Message').props.style).backgroundColor,
    ).toBe(COLORS.infoSurface);
  });
});

/* =====================================================================
 * The banner on its own
 * ================================================================== */

describe('ToastBanner defaults', () => {
  it('falls back to the neutral tone for an unknown one', () => {
    const { getByLabelText } = render(
      <ToastBanner tone="nope" text1="Title" text2="Message" />,
    );

    expect(
      flatten(getByLabelText('Title. Message').props.style).backgroundColor,
    ).toBe(COLORS.neutralSurface);
  });
});

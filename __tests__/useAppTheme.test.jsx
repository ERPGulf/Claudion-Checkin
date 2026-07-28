import { renderHook } from '@testing-library/react-native';
import { COLORS, DARK_COLORS } from '../constants';

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

// Imported after the mocks so the hook picks them up.
/* eslint-disable import/first */
import useAppTheme from '../hooks/useAppTheme';
import { setMode } from '../settings/appearance';
/* eslint-enable import/first */

function read() {
  return renderHook(() => useAppTheme()).result.current;
}

describe('useAppTheme', () => {
  beforeEach(async () => {
    mockScheme = 'light';
    mockNewHomeEnabled = true;
    // Real store, shared module state — reset it between cases.
    await setMode('system');
  });

  it('uses the light palette when the OS is light', () => {
    const theme = read();

    expect(theme.isDark).toBe(false);
    expect(theme.scheme).toBe('light');
    expect(theme.colors.surfaceSecondary).toBe(COLORS.surfaceSecondary);
    expect(theme.colors.textPrimary).toBe(COLORS.textPrimary);
  });

  it('uses the dark palette when the OS is dark', () => {
    mockScheme = 'dark';

    const theme = read();

    expect(theme.isDark).toBe(true);
    expect(theme.scheme).toBe('dark');
    expect(theme.colors.surfaceSecondary).toBe(DARK_COLORS.surfaceSecondary);
    expect(theme.colors.textPrimary).toBe(DARK_COLORS.textPrimary);
  });

  it('falls back to light when the OS reports no preference', () => {
    mockScheme = null;

    expect(read().isDark).toBe(false);
  });

  it('forces light for the legacy Home, even on a dark device', () => {
    mockScheme = 'dark';
    mockNewHomeEnabled = false;

    const theme = read();

    expect(theme.isDark).toBe(false);
    expect(theme.scheme).toBe('light');
    expect(theme.colors.surfaceSecondary).toBe(COLORS.surfaceSecondary);
    expect(theme.colors.cardBackground).toBe(COLORS.cardBackground);
  });
});

describe('dark palette', () => {
  it('inverts filled buttons so they stay visible', () => {
    // `primary` is near-black in both palettes, so a primary-filled button on a
    // dark card would be invisible — hence the separate buttonFill pair.
    expect(COLORS.buttonFill).toBe(COLORS.primary);
    expect(DARK_COLORS.buttonFill).not.toBe(DARK_COLORS.primary);
    expect(DARK_COLORS.buttonFillText).not.toBe(COLORS.buttonFillText);
  });

  it('overrides every surface and text token it needs to', () => {
    [
      'surface',
      'surfaceSecondary',
      'surfaceElevated',
      'cardBackground',
      'cardBorder',
      'dividerSubtle',
      'iconBackground',
      'skeleton',
      'textPrimary',
      'textSecondary',
      'textMuted',
      'accentSurface',
    ].forEach(token => {
      expect(DARK_COLORS[token]).not.toBe(COLORS[token]);
    });
  });

  it('keeps the brand accent so the two palettes stay recognisable', () => {
    expect(DARK_COLORS.primary2).toBe(COLORS.primary2);
  });
});

describe('appearance mode overrides the system', () => {
  beforeEach(async () => {
    mockScheme = 'light';
    mockNewHomeEnabled = true;
    await setMode('system');
  });

  afterAll(async () => {
    await setMode('system');
  });

  it('pins dark on a light device', async () => {
    await setMode('dark');

    const theme = read();

    expect(theme.mode).toBe('dark');
    expect(theme.isDark).toBe(true);
    expect(theme.colors.surfaceSecondary).toBe(DARK_COLORS.surfaceSecondary);
  });

  it('pins light on a dark device', async () => {
    mockScheme = 'dark';
    await setMode('light');

    const theme = read();

    expect(theme.mode).toBe('light');
    expect(theme.isDark).toBe(false);
    expect(theme.colors.surfaceSecondary).toBe(COLORS.surfaceSecondary);
  });

  it('defers to the device on system', async () => {
    mockScheme = 'dark';

    expect(read().isDark).toBe(true);

    mockScheme = 'light';

    expect(read().isDark).toBe(false);
  });

  it('still forces light for the legacy Home, even when dark is pinned', async () => {
    await setMode('dark');
    mockNewHomeEnabled = false;

    const theme = read();

    // The stored preference is preserved — only the resolved palette is gated,
    // so turning the experiment back on restores the user's choice.
    expect(theme.mode).toBe('dark');
    expect(theme.isDark).toBe(false);
    expect(theme.darkAvailable).toBe(false);
    expect(theme.colors.surfaceSecondary).toBe(COLORS.surfaceSecondary);
  });

  it('reports dark as available when the new UI is on', () => {
    expect(read().darkAvailable).toBe(true);
  });
});

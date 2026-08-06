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

  it('takes the brand accent from the wordmark at both ends of the palette', () => {
    // The accent used to be one orange shared by both palettes. It is now the
    // Claudion teal, and the mark only contains two tones — a deep ink and a
    // mint, with no mid-tones — so each palette takes the end it can actually
    // show: the ink is 1.72:1 on the dark page and the mint is 1.70:1 on white.
    // Same hue, opposite ends, which is what `buttonFill` already does.
    expect(COLORS.primary2).toBe('#084048');
    expect(DARK_COLORS.primary2).toBe('#20E0B0');
    expect(DARK_COLORS.primary2).not.toBe(COLORS.primary2);
  });

  it('leaves every semantic colour exactly where it was', () => {
    // The accent swap must not touch meaning. Warning in particular is orange —
    // the same family as the old accent — so it is the one most likely to be
    // caught by a careless find-and-replace.
    expect(COLORS.warningSurface).toBe('#FFF4E5');
    expect(COLORS.warningBorder).toBe('#FDE4B0');
    expect(COLORS.warningText).toBe('#9A5B00');
    expect(COLORS.successText).toBe('#0A7C3E');
    expect(COLORS.errorText).toBe('#B00E0E');
    expect(COLORS.infoText).toBe('#1B4FA8');

    expect(DARK_COLORS.warningText).toBe('#EFB35C');
    expect(DARK_COLORS.successText).toBeDefined();
    expect(DARK_COLORS.errorText).toBe('#F58A8A');
    expect(DARK_COLORS.infoText).toBe('#8CB4F5');

    // Success stays green and warning stays orange — not teal, not each other.
    expect(COLORS.successText).not.toBe(COLORS.accentText);
    expect(COLORS.warningText).not.toBe(COLORS.accentText);
  });

  it('keeps the accent legible against its own palette', () => {
    const lum = ([r, g, b]) => {
      const f = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const ratio = (a, b) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };

    // AA for text, on the surface each one is actually drawn on.
    expect(ratio(COLORS.accentText, COLORS.cardBackground)).toBeGreaterThan(4.5);
    expect(ratio(COLORS.accentText, COLORS.accentSurface)).toBeGreaterThan(4.5);
    expect(
      ratio(DARK_COLORS.accentText, DARK_COLORS.surfaceSecondary),
    ).toBeGreaterThan(4.5);
    expect(
      ratio(DARK_COLORS.accentText, DARK_COLORS.accentSurface),
    ).toBeGreaterThan(4.5);

    // And the filled control's label against its own fill.
    expect(ratio(COLORS.accentFillText, COLORS.accentFill)).toBeGreaterThan(4.5);
    expect(
      ratio(DARK_COLORS.accentFillText, DARK_COLORS.accentFill),
    ).toBeGreaterThan(4.5);
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

import React from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark blocks below flip it.
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

// Native module — there is nothing to blur in the test renderer, so this stands
// in for it and lets the props be asserted.
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: props => <View testID="blur-view" {...props} /> };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }) => <Text>{`icon:${name}`}</Text> };
});

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text>{`icon:${name}`}</Text>,
  };
});

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
import WelcomeScreen from '../screens/WelcomeScreen';
import BrandMark, {
  BRAND_MARK_MAX_WIDTH,
  WORDMARK_ASPECT,
} from '../components/Welcome/BrandMark';
import AccentHalo from '../components/Welcome/AccentHalo';
import ShimmerField from '../components/Welcome/ShimmerField';
import ActionButton from '../components/common/ActionButton';
import { withAlpha } from '../utils/color';
import { BUILD_TAG, COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

const SUBTITLE = 'Everything you need for work,\nin one secure place.';

/** Walks the rendered tree collecting every node's flattened style. */
function collectStyles(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props?.style) out.push(flatten(node.props.style));
  (node.children || []).forEach(child => collectStyles(child, out));
  return out;
}

beforeEach(() => {
  mockScheme = 'light';
  mockNewHomeEnabled = true;
  mockReduceMotion = false;
  jest.clearAllMocks();
});

/* =====================================================================
 * The toggle
 * ================================================================== */

describe('Welcome screen container', () => {
  it('renders the modern welcome when the modern UI is on', () => {
    const { getByText, queryByText } = render(<WelcomeScreen />);

    expect(getByText('Welcome')).toBeTruthy();
    expect(getByText('Get Started')).toBeTruthy();
    expect(queryByText('GET STARTED')).toBeNull();
  });

  it('renders the untouched classic welcome when the modern UI is off', () => {
    mockNewHomeEnabled = false;

    const { getByText, queryByText } = render(<WelcomeScreen />);

    expect(getByText('GET STARTED')).toBeTruthy();
    expect(queryByText('Welcome')).toBeNull();
  });
});

/* =====================================================================
 * Hierarchy + copy
 * ================================================================== */

describe('modern Welcome screen', () => {
  it('leads with the logo, then a header and a two-line subtitle', () => {
    const { getByText, getByLabelText } = render(<WelcomeScreen />);

    expect(getByLabelText('Claudion')).toBeTruthy();

    const title = getByText('Welcome');
    expect(title.props.accessibilityRole).toBe('header');
    expect(flatten(title.props.style)).toMatchObject({
      fontSize: 28,
      fontWeight: '700',
    });

    const subtitle = getByText(SUBTITLE);
    expect(flatten(subtitle.props.style).textAlign).toBe('center');
    // Not line-capped: at large accessibility type it must wrap, not truncate.
    expect(subtitle.props.numberOfLines).toBeUndefined();
  });

  it('keeps the build stamp, demoted to a footer', () => {
    const { getByText } = render(<WelcomeScreen />);

    const stamp = getByText(BUILD_TAG);
    const style = flatten(stamp.props.style);

    expect(style.color).toBe(COLORS.textMuted);
    expect(style.fontSize).toBeLessThan(14);
  });

  it('routes the primary action to the QR scanner, as before', () => {
    const { getByText } = render(<WelcomeScreen />);

    fireEvent.press(getByText('Get Started'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  });

  it('does not promise features the tenant may not have enabled', () => {
    const { queryByText } = render(<WelcomeScreen />);

    ['Attendance', 'Leave', 'Payroll', 'Expenses'].forEach(word =>
      expect(queryByText(new RegExp(word))).toBeNull(),
    );
  });

  it('lights the page in the mark\'s mint, and nothing else', () => {
    // The logo is deep teal with a mint swoosh, so the brand orange behind it —
    // the palette's only brand hue, and the wordmark's near-complement — read as a
    // peach stain rather than as light the mark could have cast. Warming the
    // bottom of the page towards the CTA had the same problem: orange at any
    // visible alpha composites to pink over a near-white page.
    const { toJSON } = render(<WelcomeScreen />);

    const rgbOf = fill => /rgba\(([^)]+?),\s*[\d.]+\)/.exec(fill)[1];
    const hues = new Set(
      collectStyles(toJSON())
        .map(s => s.backgroundColor)
        .filter(c => typeof c === 'string' && c.startsWith('rgba('))
        .map(rgbOf),
    );

    // BRAND_MARK_GLOW, sampled off the artwork — and it is the only hue up there.
    expect([...hues]).toEqual(['29, 233, 185']);
  });

  it('carries no brand orange at all, in the field or on the button', () => {
    const { toJSON } = render(<WelcomeScreen />);

    const orange = collectStyles(toJSON())
      .map(s => s.backgroundColor)
      .filter(
        c => typeof c === 'string' && c.toUpperCase().includes('F87627'),
      );

    expect(orange).toEqual([]);
  });

  it('separates the moving field from the content with a blur layer', () => {
    // The field is what makes the page feel alive; the blur is what stops it
    // competing with the words on top of it.
    const { getByTestId } = render(<WelcomeScreen />);
    const blur = getByTestId('blur-view');

    expect(blur.props.intensity).toBeGreaterThan(0);
    expect(blur.props.tint).toBe('light');
    expect(blur.props.pointerEvents).toBe('none');
  });

  it('never turns on Android\'s real blur, which ghosts the whole page', () => {
    // Regression guard, measured on device: `dimezisBlurView` blurs a snapshot of
    // the entire root view — the content on top of this layer included — so it
    // paints a blurred copy of the wordmark, the title and the button underneath
    // the crisp ones. Every element wore a ghost of itself. iOS is unaffected
    // either way; it blurs only what is genuinely behind the layer.
    const { getByTestId } = render(<WelcomeScreen />);

    expect(
      getByTestId('blur-view').props.experimentalBlurMethod,
    ).toBeUndefined();
  });

  it('flips the blur tint with the palette', () => {
    mockScheme = 'dark';

    expect(render(<WelcomeScreen />).getByTestId('blur-view').props.tint).toBe(
      'dark',
    );
  });

  it('scrolls rather than clips, so large type has somewhere to go', () => {
    const { UNSAFE_getByType } = render(<WelcomeScreen />);
    const { ScrollView } = require('react-native');

    const scroller = UNSAFE_getByType(ScrollView);
    // flexGrow keeps it a flex column at default type and scrollable beyond it.
    expect(flatten(scroller.props.contentContainerStyle).flexGrow).toBe(1);
  });
});

/* =====================================================================
 * The CTA — the app's standard filled control
 * ================================================================== */

describe('modern Welcome CTA', () => {
  it('takes the standard filled control, not the brand accent', () => {
    const light = render(<WelcomeScreen />);
    expect(
      flatten(light.getByLabelText('Get Started').props.style).backgroundColor,
    ).toBe(COLORS.buttonFill);
    // No orange on this screen at all any more — the atmosphere carries the
    // brand, and the button is the same control every other screen uses.
    expect(COLORS.buttonFill).not.toBe(COLORS.accentFill);
  });

  it('inverts in dark mode, because the fill is near-black', () => {
    // `buttonFill` is #110E11 on light — a near-black button on a near-black page
    // would be invisible, which is why the token flips rather than staying put.
    mockScheme = 'dark';
    const dark = render(<WelcomeScreen />);

    expect(
      flatten(dark.getByLabelText('Get Started').props.style).backgroundColor,
    ).toBe(DARK_COLORS.buttonFill);
    expect(DARK_COLORS.buttonFill).not.toBe(COLORS.buttonFill);
  });

  it('labels the fill with its paired foreground in both palettes', () => {
    const light = render(<WelcomeScreen />);
    expect(flatten(light.getByText('Get Started').props.style).color).toBe(
      COLORS.buttonFillText,
    );

    mockScheme = 'dark';
    const dark = render(<WelcomeScreen />);
    expect(flatten(dark.getByText('Get Started').props.style).color).toBe(
      DARK_COLORS.buttonFillText,
    );
  });

  it('is the tallest control on the page', () => {
    const { getByLabelText } = render(<WelcomeScreen />);

    expect(flatten(getByLabelText('Get Started').props.style).minHeight).toBe(54);
  });

  it('points the arrow along the reading direction', () => {
    const { getByText, unmount } = render(<WelcomeScreen />);
    expect(getByText('icon:arrow-forward')).toBeTruthy();
    unmount();

    I18nManager.isRTL = true;
    try {
      const rtl = render(<WelcomeScreen />);
      expect(rtl.getByText('icon:arrow-back')).toBeTruthy();
    } finally {
      I18nManager.isRTL = false;
    }
  });
});

/* =====================================================================
 * ActionButton's new variant, in isolation
 * ================================================================== */

describe('ActionButton accent variant', () => {
  it('uses the accent fill and its paired label colour', () => {
    const { getByLabelText, getByText } = render(
      <ActionButton label="Go" variant="accent" onPress={() => {}} />,
    );

    expect(flatten(getByLabelText('Go').props.style).backgroundColor).toBe(
      COLORS.accentFill,
    );
    expect(flatten(getByText('Go').props.style).color).toBe(
      COLORS.accentFillText,
    );
  });

  it('leaves the existing variants untouched', () => {
    const filled = render(<ActionButton label="A" onPress={() => {}} />);
    expect(flatten(filled.getByLabelText('A').props.style).backgroundColor).toBe(
      COLORS.buttonFill,
    );

    const outline = render(
      <ActionButton label="B" variant="outline" onPress={() => {}} />,
    );
    expect(
      flatten(outline.getByLabelText('B').props.style).backgroundColor,
    ).toBe(COLORS.cardBackground);

    const tinted = render(
      <ActionButton label="C" variant="tinted" tone="success" onPress={() => {}} />,
    );
    expect(flatten(tinted.getByLabelText('C').props.style).backgroundColor).toBe(
      COLORS.successSurface,
    );
  });

  it('still greys out when disabled, accent or not', () => {
    const { getByLabelText } = render(
      <ActionButton label="D" variant="accent" disabled onPress={() => {}} />,
    );

    const style = flatten(getByLabelText('D').props.style);
    expect(style.backgroundColor).toBe(COLORS.iconBackground);
    expect(style.backgroundColor).not.toBe(COLORS.accentFill);
  });
});

/* =====================================================================
 * Depth — the glow, built without a gradient library
 * ================================================================== */

describe('ShimmerField', () => {
  it('covers the whole page, under the safe area rather than inside it', () => {
    const { toJSON } = render(<ShimmerField />);
    const root = flatten(toJSON().props.style);

    expect(root).toMatchObject({ position: 'absolute', top: 0, bottom: 0 });
  });

  it('runs its falloff off every edge, so no field has a visible border', () => {
    // A soft field whose fade ends inside the page draws a shape. The only place
    // one of these is allowed to be cut is the screen boundary.
    const { toJSON } = render(<ShimmerField />);

    const fields = (toJSON().children || []).map(child =>
      flatten(child.props.style),
    );
    expect(fields.length).toBeGreaterThanOrEqual(3);

    fields.forEach(field => {
      expect(parseFloat(field.left)).toBeLessThan(0);
      expect(parseFloat(field.right)).toBeLessThan(0);
    });

    // Top to bottom too: the first starts above the page, the last ends below it.
    expect(parseFloat(fields[0].top)).toBeLessThan(0);
    const last = fields[fields.length - 1];
    expect(parseFloat(last.top) + parseFloat(last.height)).toBeGreaterThan(100);
  });

  it('overlaps its fields, because abutting them draws seams', () => {
    // Each field is faintest at its own edges, so three tidy bands put weakness
    // against weakness and striped the page.
    const { toJSON } = render(<ShimmerField />);
    const spans = (toJSON().children || [])
      .map(child => flatten(child.props.style))
      .map(s => [parseFloat(s.top), parseFloat(s.top) + parseFloat(s.height)]);

    spans.slice(1).forEach(([top], i) => {
      const [, previousBottom] = spans[i];
      expect(top).toBeLessThan(previousBottom);
    });
  });

  it('drifts each field, on its own period so the loop never lines up', () => {
    const { toJSON } = render(<ShimmerField />);
    const fields = (toJSON().children || []).map(child =>
      flatten(child.props.style),
    );

    fields.forEach(field => {
      expect(field.transform).toBeDefined();
      expect(field.transform.map(t => Object.keys(t)[0])).toEqual([
        'translateX',
        'translateY',
      ]);
    });
  });

  it('is completely still under reduce motion', () => {
    mockReduceMotion = true;

    const { toJSON } = render(<ShimmerField />);

    (toJSON().children || []).forEach(child =>
      expect(flatten(child.props.style).transform).toBeUndefined(),
    );
  });

  it('never eats a touch and is hidden from screen readers', () => {
    const root = render(<ShimmerField />).toJSON();

    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('AccentHalo', () => {
  it('stacks translucent layers of the brand orange', () => {
    const { toJSON } = render(<AccentHalo intensity={0.2} />);

    const layers = collectStyles(toJSON()).filter(s => s.backgroundColor);
    // Enough layers that each edge is about a percent of alpha from the next —
    // below the step where a flat colour boundary reads as a visible band.
    expect(layers.length).toBeGreaterThanOrEqual(12);

    // Every layer is the same low alpha; the centre accumulates all of them.
    const fills = new Set(layers.map(s => s.backgroundColor));
    expect(fills.size).toBe(1);

    const [fill] = [...fills];
    const alpha = Number(/rgba\(.+,\s*([\d.]+)\)/.exec(fill)[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.02);
    // Composited back to the requested centre intensity.
    expect(1 - (1 - alpha) ** layers.length).toBeCloseTo(0.2, 2);
  });

  it('keeps a constant centre intensity when the layer count is solved for', () => {
    const faint = render(<AccentHalo intensity={0.06} />);
    const strong = render(<AccentHalo intensity={0.22} />);

    const alphaOf = tree => {
      const fill = collectStyles(tree).find(s => s.backgroundColor)
        ?.backgroundColor;
      return Number(/rgba\(.+,\s*([\d.]+)\)/.exec(fill)[1]);
    };

    expect(alphaOf(strong.toJSON())).toBeGreaterThan(alphaOf(faint.toJSON()));
  });

  /* ---- The wave ---- */

  it('is still by default, because ambient motion is opt-in', () => {
    const style = flatten(render(<AccentHalo />).toJSON().props.style);

    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });

  it('breathes on opacity and scale when asked', () => {
    const style = flatten(render(<AccentHalo wave />).toJSON().props.style);

    expect(style.opacity).toBeDefined();
    expect(style.transform).toBeDefined();
  });

  it('never scales past its box, which Android would clip to a hard edge', () => {
    // Layer 0 fills the parent exactly, so a bloom that swelled outward would
    // grow a rectangular corner on Android instead of spreading. The wave has to
    // breathe inward.
    const style = flatten(render(<AccentHalo wave />).toJSON().props.style);
    const scale = style.transform[0].scale;

    [0, 0.5, 1].forEach(t =>
      expect(Number(scale.__getValue?.() ?? 1)).toBeLessThanOrEqual(1, t),
    );
    expect(Number(scale.__getValue?.() ?? 1)).toBeGreaterThan(0.5);
  });

  it('drops the wave under reduce motion, at full strength not parked dim', () => {
    // The trap: interpolating a stopped value would leave the halo sitting at the
    // bottom of the range for good — dimmer and smaller than the still halo it is
    // meant to fall back to.
    mockReduceMotion = true;

    const style = flatten(render(<AccentHalo wave />).toJSON().props.style);

    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });

  it('never eats a touch and is hidden from screen readers', () => {
    const { toJSON } = render(<AccentHalo />);
    const root = toJSON();

    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('stays inside its parent, because Android clips to the parent rect', () => {
    const { toJSON } = render(<AccentHalo />);

    collectStyles(toJSON())
      .filter(s => s.backgroundColor)
      .forEach(s => {
        // Insets are non-negative percentages — nothing pokes outside the box.
        ['top', 'bottom', 'left', 'right'].forEach(side => {
          expect(parseFloat(s[side])).toBeGreaterThanOrEqual(0);
        });
      });
  });
});

/* =====================================================================
 * Entrance animation
 * ================================================================== */

describe('modern Welcome entrance', () => {
  it('settles to fully visible', () => {
    jest.useFakeTimers();
    const { getByText } = render(<WelcomeScreen />);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // Still on screen and interactive once the animation has run.
    fireEvent.press(getByText('Get Started'));
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');

    jest.useRealTimers();
  });

  it('skips straight to the settled state under reduce motion', () => {
    mockReduceMotion = true;

    const { getByText, getByLabelText } = render(<WelcomeScreen />);

    // No waiting: everything is present and pressable immediately.
    expect(getByLabelText('Claudion')).toBeTruthy();
    fireEvent.press(getByText('Get Started'));
    expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern Welcome screen in dark mode', () => {
  it('takes its text colours from the dark palette', () => {
    const light = render(<WelcomeScreen />);
    expect(flatten(light.getByText('Welcome').props.style).color).toBe(
      COLORS.textPrimary,
    );

    mockScheme = 'dark';
    const dark = render(<WelcomeScreen />);

    expect(flatten(dark.getByText('Welcome').props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    expect(flatten(dark.getByText(SUBTITLE).props.style).color).toBe(
      DARK_COLORS.textSecondary,
    );
    expect(flatten(dark.getByText(BUILD_TAG).props.style).color).toBe(
      DARK_COLORS.textMuted,
    );
  });
});

/* =====================================================================
 * The logo
 * ================================================================== */

describe('BrandMark', () => {
  it('presents the wordmark untouched, at the lockup aspect', () => {
    const { getByLabelText } = render(<BrandMark width={280} />);

    const mark = getByLabelText('Claudion');
    const style = flatten(mark.props.style);

    expect(style.width / style.height).toBeCloseTo(WORDMARK_ASPECT, 3);
    expect(mark.props.contentFit).toBe('contain');
    // Never recoloured — the brand ships the variants, we don't synthesise them.
    expect(style.tintColor).toBeUndefined();
  });

  it('wears no card in either theme', () => {
    // The whole point of shipping two ink variants: nothing has to prop the mark
    // up any more.
    const light = render(<BrandMark width={280} />);
    let root = flatten(light.toJSON().props.style);
    expect(root.backgroundColor).toBeUndefined();
    expect(root.borderWidth).toBeUndefined();
    expect(root.shadowOpacity).toBeUndefined();

    mockScheme = 'dark';
    const dark = render(<BrandMark width={280} />);
    root = flatten(dark.toJSON().props.style);
    expect(root.backgroundColor).toBeUndefined();
    expect(root.borderWidth).toBeUndefined();
    expect(root.shadowOpacity).toBeUndefined();
  });

  it('swaps to the light-ink asset in dark mode', () => {
    const light = render(<BrandMark />).getByLabelText('Claudion').props.source;

    mockScheme = 'dark';
    const dark = render(<BrandMark />).getByLabelText('Claudion').props.source;

    // Two different files — #003030 ink on the light page, #F0F0F0 on the dark.
    expect(dark).not.toEqual(light);
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
  });

  it('keeps identical geometry across themes, so the logo never jumps', () => {
    // Both files are cropped to the union of the two inks, so a theme flip must
    // not move or resize the mark by a single point.
    const light = flatten(
      render(<BrandMark width={300} />).getByLabelText('Claudion').props.style,
    );

    mockScheme = 'dark';
    const dark = flatten(
      render(<BrandMark width={300} />).getByLabelText('Claudion').props.style,
    );

    expect(dark.width).toBe(light.width);
    expect(dark.height).toBe(light.height);
  });

  it('scales with the width it is given, at a constant aspect', () => {
    const narrow = flatten(
      render(<BrandMark width={220} />).getByLabelText('Claudion').props.style,
    );
    const wide = flatten(
      render(<BrandMark width={300} />).getByLabelText('Claudion').props.style,
    );

    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(wide.width / wide.height).toBeCloseTo(
      narrow.width / narrow.height,
      3,
    );
  });

  it('defaults to the shared max width', () => {
    const { getByLabelText } = render(<BrandMark />);
    expect(flatten(getByLabelText('Claudion').props.style).width).toBe(
      BRAND_MARK_MAX_WIDTH,
    );
  });
});

/* =====================================================================
 * The alpha helper
 * ================================================================== */

describe('withAlpha', () => {
  it('converts long and short hex, clamping alpha', () => {
    expect(withAlpha('#F87627', 0.5)).toBe('rgba(248, 118, 39, 0.5)');
    expect(withAlpha('#FFF', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('F87627', 2)).toBe('rgba(248, 118, 39, 1)');
    expect(withAlpha('#F87627', -1)).toBe('rgba(248, 118, 39, 0)');
  });

  it('passes through anything that is not hex, rather than corrupting it', () => {
    expect(withAlpha('rgba(0,0,0,0.5)', 0.2)).toBe('rgba(0,0,0,0.5)');
    expect(withAlpha('transparent', 0.2)).toBe('transparent');
    expect(withAlpha(undefined, 0.2)).toBeUndefined();
  });
});

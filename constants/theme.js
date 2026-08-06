import { Dimensions, StatusBar } from 'react-native';

const { height, width } = Dimensions.get('window');

/**
 * The brand accent, taken from the Claudion wordmark rather than picked.
 *
 * The mark is deliberately two-tone — sampled from `assets/claudion-wordmark-*`,
 * it is 32k pixels of one deep teal ink and 7k of one mint, with **no mid-tones
 * between them**. So these two are the entire brand teal, and every accent token
 * below is one of them or a tint of one of them. Nothing here is a third green.
 *
 * They also happen to be near-perfect mirrors, which is what makes a single
 * accent work in both palettes: the deep ink is 11.43:1 on white, and the mint is
 * 11.57:1 on the dark page. Light mode uses the ink for anything that has to be
 * read and the mint for tints; dark mode swaps to the mint for the same reason
 * `buttonFill` inverts — the ink is 1.72:1 against a near-black page and would
 * disappear.
 *
 * This replaced `#F87627`, which was the accent everywhere the app wanted to feel
 * branded. The orange was never the brand's; the teal is in the logo.
 */
const BRAND_TEAL_DEEP = '#084048';
const BRAND_TEAL_MINT = '#20E0B0';

const COLORS = {
  primary: '#110E11',
  // The brand accent. Consumed as the decorative accent across the modern UI —
  // active tabs, accent icons, avatar initials, selected states, the halo.
  primary2: BRAND_TEAL_DEEP,
  secondary: '#DDF0FF',
  tertiary: '#E9BD21',

  gray: '#83829A',
  gray2: '#C1C0C8',

  offwhite: '#F3F4F8',
  white: '#FFFFFF',
  black: '#000000',
  red: '#D21212',
  green: '#00C135',
  lightWhite: '#FAFAFC',

  /* ------------------------------------------------------------------
   * Semantic tokens (additive — nothing above was renamed or removed).
   * Prefer these in new UI so a dark-mode swap only touches this file.
   * ------------------------------------------------------------------ */

  // Surfaces
  surface: '#FFFFFF', // default page/base surface
  surfaceSecondary: '#F4F5F7', // app background behind cards (was `bg-gray-200`)
  surfaceElevated: '#FFFFFF', // cards that cast a shadow
  cardBackground: '#FFFFFF', // alias used by card components
  iconBackground: '#F1F2F5', // neutral chip behind a feature icon
  skeleton: '#EDEEF1', // loading placeholder fill

  // Lines
  cardBorder: '#EBECF0', // 1px hairline; replaces 2px dashed borders
  dividerSubtle: '#F0F1F4', // in-card separators

  // Text (contrast-checked on #FFFFFF)
  textPrimary: '#110E11', // 18.6:1  — titles, values
  textSecondary: '#55555F', // 7.6:1  — labels, body, tile captions
  textMuted: '#7C7C88', // 4.6:1  — meta, timestamps, hints
  textOnPrimary: '#FFFFFF', // text on the dark primary surface

  // Elevation
  shadowColor: '#0B0B14', // near-black with a blue cast; softer than pure #000

  // Status triads — tinted surface + hairline border + legible foreground.
  // The border is what keeps a tinted callout box visible once the surface
  // tint gets close to the card behind it.
  successSurface: '#E9F7EE',
  successBorder: '#B7E4C7',
  successText: '#0A7C3E',
  warningSurface: '#FFF4E5',
  warningBorder: '#FDE4B0',
  warningText: '#9A5B00',
  errorSurface: '#FDECEC',
  errorBorder: '#FECDD3',
  errorText: '#B00E0E',
  infoSurface: '#EAF2FE',
  infoBorder: '#CADBFF',
  infoText: '#1B4FA8',
  // Brand accent triad. The tint comes off the **mint**, not the ink: the deep
  // teal at chip alphas composites to a grey (#EEF2F2 at 7%), which reads as a
  // disabled surface rather than a branded one. The mint stays visibly teal.
  accentSurface: '#E2FBF5', // BRAND_TEAL_MINT at 13% on white
  accentBorder: '#A1F2DE', // BRAND_TEAL_MINT at 42% — parity with the old #FFD9BE
  accentText: BRAND_TEAL_DEEP, // 11.43:1 on white, 10.53:1 on the chip above
  // Neutral triad, for states that carry no judgement (unknown / other). These
  // are aliases of iconBackground / cardBorder / textSecondary rather than new
  // colours; they exist so a `tone` can always resolve through
  // colors[`${tone}Surface`] instead of special-casing "no status".
  neutralSurface: '#F1F2F5',
  neutralBorder: '#EBECF0',
  neutralText: '#55555F',

  // Filled controls. Must invert in dark mode — `primary` is near-black, so a
  // primary-filled button on a dark card would be invisible.
  buttonFill: '#110E11',
  buttonFillText: '#FFFFFF',

  // Brand-accent fill, for the one place a screen wants the brand colour itself
  // to be the call to action rather than a tint behind a label.
  //
  // The deep ink, with a white label: 11.43:1, and 10.48:1 as a shape against the
  // page. This one **is** overridden in dark mode, unlike the orange it replaced
  // — see the note there. The hue does not change between palettes, only which
  // end of the mark's own two tones is used, which is the same thing `buttonFill`
  // already does.
  accentFill: BRAND_TEAL_DEEP,
  accentFillText: '#FFFFFF',
};

/**
 * Dark palette, resolved against `COLORS` by hooks/useAppTheme.js.
 *
 * Scope: the redesigned Home screen, the shared primitives in
 * components/common/ and the bottom tab bar. Every other screen still reads
 * `COLORS` (or hardcoded NativeWind classes) directly and is light-only.
 */
const DARK_COLORS = {
  ...COLORS,
  surface: '#121214',
  surfaceSecondary: '#0B0B0D',
  surfaceElevated: '#1B1B1F',
  cardBackground: '#1B1B1F',
  iconBackground: '#26262B',
  skeleton: '#26262B',
  cardBorder: '#2A2A30',
  dividerSubtle: '#232328',
  textPrimary: '#F5F5F7',
  textSecondary: '#B4B4BE',
  textMuted: '#8A8A96',
  textOnPrimary: '#0B0B0D',
  shadowColor: '#000000',
  successSurface: '#12301F',
  successBorder: '#1D4A30',
  successText: '#5FD98D',
  warningSurface: '#33240D',
  warningBorder: '#4A3612',
  warningText: '#EFB35C',
  errorSurface: '#361618',
  errorBorder: '#4E2226',
  errorText: '#F58A8A',
  infoSurface: '#132039',
  infoBorder: '#1E3260',
  infoText: '#8CB4F5',
  accentSurface: '#0E2924', // BRAND_TEAL_MINT at 14% on the dark page
  accentBorder: '#125344', // at 34%
  accentText: BRAND_TEAL_MINT, // 11.57:1 on the page, 9.09:1 on the chip above
  neutralSurface: '#26262B',
  neutralBorder: '#2A2A30',
  neutralText: '#B4B4BE',
  // Inverted: light fill, dark label.
  buttonFill: '#F5F5F7',
  buttonFillText: '#110E11',

  // The decorative accent swaps to the mint here. The deep ink is 1.72:1 against
  // this palette's page — a teal icon nobody can see is not an accent.
  primary2: BRAND_TEAL_MINT,

  // And so does the fill, for the same reason `buttonFill` above inverts: a
  // #084048 button on a #0B0B0D page is a dark rectangle on a dark page. The mint
  // is 11.57:1 as a shape, and takes the near-black label back (11.28:1) — white
  // on mint would be 1.70:1 and illegible. Same hue as light mode, other end of
  // the mark.
  accentFill: BRAND_TEAL_MINT,
  accentFillText: '#110E11',
};

const SIZES = {
  xSmall: 10,
  small: 12,
  medium: 16,
  large: 20,
  xLarge: 24,
  xxLarge: 26,
  xxxLarge: 44,
  height: height - StatusBar.currentHeight,
  width,
  topOffset: StatusBar.currentHeight,
};

/** 8pt grid. 4 is the only half-step, used for optical nudges. */
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16, // standard screen margin
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

const RADIUS = {
  sm: 8, // icon chips, badges
  md: 12, // tiles, buttons
  lg: 16, // inner cards
  xl: 20, // module + welcome cards
  xxl: 24, // floating tab bar
  pill: 999,
};

/**
 * Type scale (iOS-ish). Spread onto <Text style={...}>; every entry pairs a
 * size with a line height so vertical rhythm survives font scaling.
 */
const TYPO = {
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title3: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  headline: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  caption2: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
};

/**
 * Shared layout constants. `tabBarContentHeight` is the icon row *above* the
 * bottom safe-area inset — 48 matches UIKit's 49pt bar so the home-indicator
 * gap doesn't read as dead space. Both the tab navigator and the screens that
 * reserve room for it read this, since importing across those two modules
 * directly would be circular.
 */
const LAYOUT = {
  tabBarContentHeight: 48,
  /** Active-tab pill. 40 keeps a 24pt icon centred with an 8pt tint ring. */
  tabBarPillSize: 40,
};

/** Icon sizes — one ladder so glyphs stop drifting between screens. */
const ICON = {
  sm: 16, // inline chevrons, badges
  md: 20, // module header icons, tab bar secondary
  lg: 24, // feature tiles, notification bell
  xl: 28, // tab bar active
};

const SHADOWS = {
  small: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 5.84,
    elevation: 5,
  },

  /* Soft elevation set — low opacity, wide blur, no visible dark edge. */
  card: {
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  raised: {
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  /**
   * Bottom-docked surfaces. Casts upward, and a touch stronger than `card`
   * because it has to separate a white bar from white cards scrolling
   * underneath it — but light enough that it doesn't trace the corner radius.
   */
  floating: {
    shadowColor: COLORS.shadowColor,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
};

export {
  // The two tones the whole accent system is built from. Exported for the one
  // legitimate case the palette cannot serve: a surface that is dark in *both*
  // palettes (the Profile hero is `colors.primary`), where `primary2` would hand
  // light mode the deep ink and make the accent invisible. Such a surface picks
  // BRAND_TEAL_MINT deliberately. Everything else must use the tokens.
  BRAND_TEAL_DEEP,
  BRAND_TEAL_MINT,
  COLORS,
  DARK_COLORS,
  SIZES,
  SPACING,
  RADIUS,
  TYPO,
  ICON,
  LAYOUT,
  SHADOWS,
};

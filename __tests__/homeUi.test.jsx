import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

// jest.config.js does not transform @expo/vector-icons (ESM), so stub the
// families these components use. Nothing here depends on real glyphs.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    Ionicons: stub,
    MaterialCommunityIcons: stub,
    AntDesign: stub,
    Octicons: stub,
    FontAwesome: stub,
    Entypo: stub,
  };
});

import Avatar from '../components/common/Avatar';
import EmptyState from '../components/common/EmptyState';
import FeatureTile from '../components/common/FeatureTile';
import ModuleCard from '../components/common/ModuleCard';
import NotificationButton from '../components/common/NotificationButton';
import SectionHeader from '../components/common/SectionHeader';
import {
  getInitials,
  isRtlText,
  resolveTextAlign,
} from '../utils/textDirection';
import {
  COLORS,
  DARK_COLORS,
  RADIUS,
  SPACING,
  TYPO,
  ICON,
  SHADOWS,
} from '../constants';

const colorOf = node => StyleSheet.flatten(node.props.style).color;

describe('design tokens', () => {
  it('keeps the pre-existing tokens that older screens still import', () => {
    expect(COLORS.primary).toBe('#110E11');
    expect(COLORS.primary2).toBe('#F87627');
    expect(COLORS.offwhite).toBe('#F3F4F8');
    expect(SHADOWS.small).toBeDefined();
    expect(SHADOWS.medium).toBeDefined();
  });

  it('exposes the semantic tokens the Home UI depends on', () => {
    ['surfaceSecondary', 'cardBackground', 'cardBorder', 'dividerSubtle',
      'iconBackground', 'textPrimary', 'textSecondary', 'textMuted',
      'shadowColor', 'skeleton', 'accentSurface'].forEach(token => {
      expect(COLORS[token]).toBeDefined();
    });
    expect(SPACING.lg).toBe(16);
    expect(RADIUS.xl).toBe(20);
    expect(TYPO.title2.lineHeight).toBeGreaterThan(TYPO.title2.fontSize);
    expect(ICON.lg).toBe(24);
    expect(SHADOWS.card).toBeDefined();
  });
});

describe('textDirection', () => {
  it('detects right-to-left strings', () => {
    expect(isRtlText('عائشة سيثارة')).toBe(true);
    expect(isRtlText('Aisha')).toBe(false);
    expect(isRtlText(undefined)).toBe(false);
  });

  it('resolves alignment per script', () => {
    expect(resolveTextAlign('عائشة')).toBe('right');
    expect(resolveTextAlign('Aisha')).toBe('left');
    expect(resolveTextAlign('Aisha', 'center')).toBe('center');
  });

  it('builds initials from Latin and Arabic names', () => {
    expect(getInitials('Aisha Seethara')).toBe('AS');
    expect(getInitials('Aisha')).toBe('AI');
    expect(getInitials('عائشة سيثارة')).toBe('عس');
    expect(getInitials(undefined)).toBe('');
  });
});

describe('shared Home primitives', () => {
  it('renders without crashing and surfaces its labels', () => {
    const { getByText } = render(
      <>
        <Avatar name="Aisha Seethara" />
        <NotificationButton count={120} onPress={() => {}} />
        <SectionHeader
          title="Quick Access"
          actionLabel="Add New"
          actionIcon="add"
          onActionPress={() => {}}
        />
        <ModuleCard icon="people" iconFamily="Octicons" title="Human Resources">
          <FeatureTile
            icon="calendar-outline"
            label={['Attendance', 'action']}
          />
        </ModuleCard>
        <EmptyState
          title="Pin your most-used actions"
          actionLabel="Add shortcuts"
          onActionPress={() => {}}
        />
      </>,
    );

    expect(getByText('AS')).toBeTruthy();
    expect(getByText('99+')).toBeTruthy(); // counts clamp
    expect(getByText('Add New')).toBeTruthy();
    expect(getByText('Human Resources')).toBeTruthy();
    expect(getByText('Attendance action')).toBeTruthy(); // array label joins
    expect(getByText('Add shortcuts')).toBeTruthy();
  });
});

describe('shared Home primitives in dark mode', () => {
  const renderAll = () =>
    render(
      <>
        <SectionHeader title="Quick Access" />
        <ModuleCard icon="people" iconFamily="Octicons" title="Human Resources">
          <FeatureTile icon="calendar-outline" label="Attendance action" />
        </ModuleCard>
        <EmptyState
          title="Pin your most-used actions"
          actionLabel="Add shortcuts"
          onActionPress={() => {}}
        />
      </>,
    );

  afterEach(() => {
    mockScheme = 'light';
  });

  it('resolves text colours from the light palette by default', () => {
    const { getByText } = renderAll();

    expect(colorOf(getByText('Human Resources'))).toBe(COLORS.textPrimary);
    expect(colorOf(getByText('Attendance action'))).toBe(COLORS.textSecondary);
    expect(colorOf(getByText('Add shortcuts'))).toBe(COLORS.buttonFillText);
  });

  it('switches every primitive to the dark palette', () => {
    mockScheme = 'dark';
    const { getByText } = renderAll();

    expect(colorOf(getByText('Quick Access'))).toBe(DARK_COLORS.textPrimary);
    expect(colorOf(getByText('Human Resources'))).toBe(DARK_COLORS.textPrimary);
    expect(colorOf(getByText('Attendance action'))).toBe(
      DARK_COLORS.textSecondary,
    );
    // Inverted fill: a near-black button would vanish on a dark card.
    expect(colorOf(getByText('Add shortcuts'))).toBe(
      DARK_COLORS.buttonFillText,
    );
  });
});

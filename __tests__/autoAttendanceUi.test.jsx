import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

// utils/autoAttendance reaches the native module for waitForMonitoring and
// expo-location for the position helpers; neither is exercised here.
jest.mock('../modules/expo-auto-attendance', () => ({
  isMonitoring: jest.fn(() => false),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

/* eslint-disable import/first */
import StatusBadge from '../components/common/StatusBadge';
import CollapsibleCard from '../components/AutoAttendance/CollapsibleCard';
import PolicyOption from '../components/AutoAttendance/PolicyOption';
import EventLogItem from '../components/AutoAttendance/EventLogItem';
import CoordinateField from '../components/AutoAttendance/CoordinateField';
import SettingsRow, { RowDivider } from '../components/common/SettingsRow';
import {
  describeAutomatic,
  describeMonitoring,
  describePolicy,
  describePresence,
  describeTransition,
  formatDistance,
} from '../utils/autoAttendance';
import { GEOTAGGING } from '../redux/Slices/AutoAttendanceSlice';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

describe('status vocabulary', () => {
  const all = [
    describeMonitoring(true),
    describeMonitoring(false),
    describeTransition('ENTER'),
    describeTransition('EXIT'),
    describeTransition('ERROR'),
    describeTransition(undefined),
    describeAutomatic(true, true),
    describeAutomatic(true, false),
    describePolicy(GEOTAGGING.ALL_ACTIONS),
    describePolicy(GEOTAGGING.WARNINGS_ONLY),
    describePolicy(GEOTAGGING.DISABLED),
    describePresence(null, true),
    describePresence(null, false),
    describePresence({ withinRadius: true }, false),
    describePresence({ withinRadius: false }, false),
  ];

  it('resolves every tone against the real palette, in both schemes', () => {
    // The badge reads three colours off `${tone}Surface|Border|Text`. A tone with
    // no matching keys would silently fall back to neutral, so the mapping is
    // only safe if every tone it can emit actually exists.
    all.forEach(({ tone }) => {
      ['Surface', 'Border', 'Text'].forEach((slot) => {
        expect(COLORS[`${tone}${slot}`]).toBeDefined();
        expect(DARK_COLORS[`${tone}${slot}`]).toBeDefined();
      });
    });
  });

  it('gives every state a label and a glyph', () => {
    all.forEach((state) => {
      expect(typeof state.label).toBe('string');
      expect(state.label.length).toBeGreaterThan(0);
      expect(typeof state.icon).toBe('string');
    });
  });

  it('replaces the raw strings with semantic labels', () => {
    // Was: "Not Monitoring", "ENTER", "OFF".
    expect(describeMonitoring(false).label).toBe('Idle');
    expect(describeMonitoring(true).label).toBe('Monitoring');
    expect(describeTransition('ENTER').label).toBe('Entered');
    expect(describeTransition('EXIT').label).toBe('Exited');
    expect(describeAutomatic(true, false).label).toBe('Off');
  });

  it('tones monitoring green and idle neutral, never red', () => {
    expect(describeMonitoring(true).tone).toBe('success');
    expect(describeMonitoring(false).tone).toBe('neutral');
  });

  it('keeps an unknown transition neutral rather than an error', () => {
    expect(describeTransition(undefined).tone).toBe('neutral');
    expect(describeTransition('SOMETHING_NEW').tone).toBe('neutral');
  });

  it('only reports automatic as on when the policy allows every action', () => {
    expect(describeAutomatic(true, true).tone).toBe('success');
    expect(describeAutomatic(true, false).tone).toBe('neutral');
    expect(describeAutomatic(false, true).tone).toBe('neutral');
  });

  it('formats distance in metres under a kilometre', () => {
    expect(formatDistance(85)).toBe('85 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(NaN)).toBe('—');
  });
});

describe('StatusBadge', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('tints itself from the tone, so label and colour cannot disagree', () => {
    const { getByLabelText } = render(
      <StatusBadge tone="success" label="Monitoring" />,
    );

    const style = flatten(getByLabelText('Monitoring').props.style);
    expect(style.backgroundColor).toBe(COLORS.successSurface);
    expect(style.borderColor).toBe(COLORS.successBorder);
  });

  it('renders a dot instead of a glyph when asked', () => {
    const dot = render(<StatusBadge tone="success" label="A" dot />);
    const glyph = render(
      <StatusBadge tone="success" label="B" icon="flash-outline" />,
    );

    expect(dot.queryByText('icon:flash-outline')).toBeNull();
    expect(glyph.getByText('icon:flash-outline')).toBeTruthy();
  });

  it('follows the dark palette', () => {
    mockScheme = 'dark';
    const { getByLabelText } = render(
      <StatusBadge tone="error" label="Error" />,
    );

    expect(flatten(getByLabelText('Error').props.style).backgroundColor).toBe(
      DARK_COLORS.errorSurface,
    );
  });
});

describe('status row alignment', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('centres a badge in the row instead of pinning it to the top', () => {
    // `alignSelf: flex-start` overrode the row's own `alignItems: center`, so a
    // badge sat high while a plain text value in the same slot stayed centred.
    const { getByLabelText } = render(<StatusBadge tone="success" label="Monitoring" />);

    expect(flatten(getByLabelText('Monitoring').props.style).alignSelf).toBe('center');
  });

  it('gives a badge row and a plain-value row the same height', () => {
    const badgeRow = render(
      <SettingsRow size="comfortable" icon="radio-outline" title="Monitoring">
        <StatusBadge tone="success" label="Monitoring" dot />
      </SettingsRow>,
    );
    const valueRow = render(
      <SettingsRow
        size="comfortable"
        icon="time-outline"
        title="Last update"
        value="06 Aug 2026, 09:15:00"
      />,
    );

    const height = (r) =>
      flatten(r.UNSAFE_getByType(require('react-native').View).props.style).minHeight;

    expect(height(badgeRow)).toBe(64);
    expect(height(valueRow)).toBe(64);
  });

  it('derives the row height from the chip, so the two can never disagree', () => {
    const { UNSAFE_getByType } = render(
      <SettingsRow size="comfortable" icon="radio-outline" title="Monitoring" />,
    );
    const { View } = require('react-native');

    const row = flatten(UNSAFE_getByType(View).props.style);
    // 44 chip + 10 padding top and bottom.
    expect(row.minHeight).toBe(64);
    expect(row.paddingVertical).toBe(10);
    expect(row.alignItems).toBe('center');
    // Equal left and right padding.
    expect(row.paddingHorizontal).toBe(16);
  });

  it('indents the divider past the chip, and tracks the chip size', () => {
    const { View } = require('react-native');
    const comfortable = render(<RowDivider size="comfortable" />);
    const base = render(<RowDivider />);

    // 16 inset + 44 chip + 16 gap, and 16 + 36 + 12 for the default rhythm.
    expect(flatten(comfortable.UNSAFE_getByType(View).props.style).marginStart).toBe(76);
    expect(flatten(base.UNSAFE_getByType(View).props.style).marginStart).toBe(64);
  });

  it('uses the secondary text colour for a description, not the muted hint colour', () => {
    const comfortable = render(
      <SettingsRow
        size="comfortable"
        icon="shield-outline"
        title="Policy"
        description="Set by your administrator"
      />,
    );
    const base = render(
      <SettingsRow icon="shield-outline" title="Policy" description="Set by your administrator" />,
    );

    expect(
      flatten(comfortable.getByText('Set by your administrator').props.style).color,
    ).toBe(COLORS.textSecondary);
    // Profile's rows keep the muted hint colour.
    expect(
      flatten(base.getByText('Set by your administrator').props.style).color,
    ).toBe(COLORS.textMuted);
  });

  it('renders the title semibold and a plain value medium', () => {
    const { getByText } = render(
      <SettingsRow
        size="comfortable"
        icon="time-outline"
        title="Last update"
        value="06 Aug 2026"
      />,
    );

    expect(flatten(getByText('Last update').props.style).fontWeight).toBe('600');
    expect(flatten(getByText('06 Aug 2026').props.style).fontWeight).toBe('500');
  });

  it('leaves the default rhythm exactly as Profile ships it', () => {
    // Profile, Attendance Action and the settings rows all render at these
    // numbers; the new preset must not have moved them.
    const { UNSAFE_getByType } = render(
      <SettingsRow icon="person-outline" title="Profile row" />,
    );
    const row = flatten(UNSAFE_getByType(require('react-native').View).props.style);

    expect(row.minHeight).toBe(60);
    expect(row.paddingVertical).toBe(12);
    expect(row.paddingHorizontal).toBe(16);
  });
});

describe('CollapsibleCard', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('starts collapsed, so the developer tools cost no height by default', () => {
    const { queryByText, getByLabelText } = render(
      <CollapsibleCard title="Developer Tools" badgeLabel="Debug only">
        <React.Fragment />
      </CollapsibleCard>,
    );

    expect(getByLabelText('Developer Tools').props.accessibilityState.expanded).toBe(
      false,
    );
    expect(queryByText('Debug only')).toBeTruthy();
  });

  it('reveals its body on press and reports the disclosure state', () => {
    const { Text } = require('react-native');
    const { getByLabelText, queryByText } = render(
      <CollapsibleCard title="Developer Tools">
        <Text>inner content</Text>
      </CollapsibleCard>,
    );

    expect(queryByText('inner content')).toBeNull();

    fireEvent.press(getByLabelText('Developer Tools'));

    expect(queryByText('inner content')).toBeTruthy();
    expect(getByLabelText('Developer Tools').props.accessibilityState.expanded).toBe(
      true,
    );
  });

  it('collapses again on a second press', () => {
    const { Text } = require('react-native');
    const { getByLabelText, queryByText } = render(
      <CollapsibleCard title="Developer Tools">
        <Text>inner content</Text>
      </CollapsibleCard>,
    );

    fireEvent.press(getByLabelText('Developer Tools'));
    fireEvent.press(getByLabelText('Developer Tools'));

    expect(queryByText('inner content')).toBeNull();
  });
});

describe('PolicyOption', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('announces as a radio — the three policies are mutually exclusive', () => {
    const { getByLabelText } = render(
      <PolicyOption
        title="All attendance actions"
        description="Automatically checks in and out."
        selected={false}
        onPress={jest.fn()}
      />,
    );

    const row = getByLabelText('All attendance actions');
    expect(row.props.accessibilityRole).toBe('radio');
    expect(row.props.accessibilityState.checked).toBe(false);
  });

  it('carries the description to assistive tech rather than dropping it', () => {
    const { getByLabelText } = render(
      <PolicyOption
        title="Warnings only"
        description="Shows notifications only."
        selected
        onPress={jest.fn()}
      />,
    );

    const row = getByLabelText('Warnings only');
    expect(row.props.accessibilityHint).toBe('Shows notifications only.');
    expect(row.props.accessibilityState.checked).toBe(true);
  });

  it('keeps a target past the 44pt minimum', () => {
    const { getByLabelText } = render(
      <PolicyOption title="Disabled" selected={false} onPress={jest.fn()} />,
    );

    expect(
      flatten(getByLabelText('Disabled').props.style).minHeight,
    ).toBeGreaterThanOrEqual(44);
  });

  it('reports the press', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <PolicyOption title="Disabled" selected={false} onPress={onPress} />,
    );

    fireEvent.press(getByLabelText('Disabled'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('EventLogItem', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows the transition as a badge and keeps the raw token visible', () => {
    const { getByText, getByLabelText } = render(
      <EventLogItem
        entry={{ transition: 'ENTER', timestamp: 1777118400000 }}
      />,
    );

    expect(getByLabelText('Entered')).toBeTruthy();
    // A debugging screen still needs the exact token the module emitted.
    expect(getByText('ENTER')).toBeTruthy();
  });

  it('prefers the event message when there is one', () => {
    const { getByText } = render(
      <EventLogItem
        entry={{ transition: 'ERROR', message: 'Low power mode', receivedAt: 1 }}
      />,
    );

    expect(getByText('Low power mode')).toBeTruthy();
  });

  it('drops the rail on the last row so the series looks finished', () => {
    const { View } = require('react-native');
    const rails = (r) =>
      r.UNSAFE_queryAllByType(View).filter((v) => flatten(v.props.style).width === 1);

    const middle = render(
      <EventLogItem entry={{ transition: 'ENTER', receivedAt: 1 }} />,
    );
    const last = render(
      <EventLogItem entry={{ transition: 'ENTER', receivedAt: 1 }} isLast />,
    );

    expect(rails(middle)).toHaveLength(1);
    expect(rails(last)).toHaveLength(0);
  });
});

describe('CoordinateField', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('reads as the same container language as the other modern fields', () => {
    const { getByLabelText } = render(
      <CoordinateField label="Latitude" value="25.28" onChangeText={jest.fn()} />,
    );

    const input = getByLabelText('Latitude');
    expect(flatten(input.props.style).backgroundColor).toBe(
      COLORS.surfaceSecondary,
    );
    expect(input.props.keyboardType).toBe('numeric');
  });

  it('looks disabled when it cannot be typed into', () => {
    const editable = render(
      <CoordinateField label="A" value="1" onChangeText={jest.fn()} />,
    );
    const locked = render(
      <CoordinateField label="B" value="1" onChangeText={jest.fn()} editable={false} />,
    );

    expect(flatten(editable.getByLabelText('A').props.style).color).toBe(
      COLORS.textPrimary,
    );
    expect(flatten(locked.getByLabelText('B').props.style).color).toBe(
      COLORS.textMuted,
    );
    expect(locked.getByLabelText('B').props.editable).toBe(false);
  });

  it('reports edits', () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <CoordinateField label="Radius" value="100" onChangeText={onChangeText} />,
    );

    fireEvent.changeText(getByLabelText('Radius'), '250');
    expect(onChangeText).toHaveBeenCalledWith('250');
  });
});

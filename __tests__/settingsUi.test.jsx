import React from 'react';
import { Switch } from 'react-native';
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

let mockEnabled = true;
const mockSetEnabled = jest.fn();
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({
    enabled: mockEnabled,
    hydrated: true,
    setEnabled: mockSetEnabled,
  }),
}));

/* eslint-disable import/first */
import ActionButton from '../components/common/ActionButton';
import SettingsRow from '../components/common/SettingsRow';
import HomeExperienceSetting from '../components/experimental/HomeExperienceSetting';
import AppearanceSetting from '../components/settings/AppearanceSetting';
import { setMode } from '../settings/appearance';
import { COLORS, DARK_COLORS, TYPO } from '../constants';
/* eslint-enable import/first */

describe('SettingsRow', () => {
  it('shows a trailing value', () => {
    const { getByText } = render(
      <SettingsRow icon="pricetag-outline" title="Version" value="1.1.9" />,
    );

    expect(getByText('Version')).toBeTruthy();
    expect(getByText('1.1.9')).toBeTruthy();
  });

  it('adds a chevron only when pressable and no trailing child is given', () => {
    const withPress = render(
      <SettingsRow title="Sign out" onPress={() => {}} />,
    );
    expect(withPress.queryByText('icon:chevron-forward')).toBeTruthy();

    const withChild = render(
      <SettingsRow title="Toggle" onPress={() => {}}>
        <Switch value={false} />
      </SettingsRow>,
    );
    expect(withChild.queryByText('icon:chevron-forward')).toBeNull();
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <SettingsRow title="Sign out" onPress={onPress} />,
    );

    fireEvent.press(getByText('Sign out'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ActionButton', () => {
  it('does not fire while disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <ActionButton label="Checking for update" onPress={onPress} disabled />,
    );

    fireEvent.press(getByText('Checking for update'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire while loading', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <ActionButton label="Check out" onPress={onPress} loading />,
    );

    fireEvent.press(getByText('Check out'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports busy to assistive tech while loading', () => {
    const { getByLabelText } = render(
      <ActionButton label="Check out" onPress={() => {}} loading />,
    );

    expect(getByLabelText('Check out').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it('tints from the requested tone', () => {
    const { getByText } = render(
      <ActionButton label="Test toast" variant="tinted" tone="warning" />,
    );

    expect(getByText('Test toast').props.style.color).toBe(COLORS.warningText);
  });

  it('renders the outline variant on the card surface, not a fill', () => {
    const { getByText } = render(
      <ActionButton label="Take break" variant="outline" onPress={() => {}} />,
    );

    // Secondary must read as the same material as the cards around it.
    expect(getByText('Take break').props.style.color).toBe(COLORS.textPrimary);
  });

  it('grows to the large size for a screen-level primary action', () => {
    const md = render(<ActionButton label="A" onPress={() => {}} />);
    const lg = render(<ActionButton label="B" size="lg" onPress={() => {}} />);

    expect(md.getByText('A').props.style.fontSize).toBe(TYPO.headline.fontSize);
    expect(lg.getByText('B').props.style.fontSize).toBe(TYPO.title3.fontSize);
  });
});

describe('Experimental UI section', () => {
  beforeEach(() => {
    mockEnabled = true;
    mockSetEnabled.mockClear();
  });

  it('uses the renamed copy', () => {
    const { getByText, queryByText } = render(<HomeExperienceSetting />);

    expect(getByText('Experimental UI')).toBeTruthy();
    expect(getByText('Enable New UI')).toBeTruthy();
    expect(
      getByText(
        'Switch between the classic interface and the redesigned interface.',
      ),
    ).toBeTruthy();

    // Old labels are gone.
    expect(queryByText('Experimental Features')).toBeNull();
    expect(queryByText('New Home Experience')).toBeNull();
  });

  it('still drives the existing flag — the rename is copy only', () => {
    const { UNSAFE_getByType } = render(<HomeExperienceSetting />);

    fireEvent(UNSAFE_getByType(Switch), 'valueChange', false);

    expect(mockSetEnabled).toHaveBeenCalledWith(false);
  });

  it('reflects the flag being off', () => {
    mockEnabled = false;
    const { UNSAFE_getByType } = render(<HomeExperienceSetting />);

    expect(UNSAFE_getByType(Switch).props.value).toBe(false);
  });
});

describe('Appearance section', () => {
  beforeEach(async () => {
    mockScheme = 'light';
    mockEnabled = true;
    await setMode('system');
  });

  afterAll(async () => {
    await setMode('system');
  });

  it('renders all three modes', () => {
    const { getByText } = render(<AppearanceSetting />);

    expect(getByText('Appearance')).toBeTruthy();
    expect(getByText('System')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
  });

  it('explains why the control is inert when Modern UI is off', () => {
    mockEnabled = false;
    const { getByText } = render(<AppearanceSetting />);

    expect(getByText('Turn on Modern UI to use dark mode.')).toBeTruthy();
  });

  it('follows the dark palette', async () => {
    await setMode('dark');
    const { getByText } = render(<AppearanceSetting />);

    expect(getByText('Theme').props.style.color).toBe(DARK_COLORS.textPrimary);
  });
});

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { setLanguage } from '../localization';
import Text from '../localization/LocalizedText';
import LocaleRoot from '../localization/LocaleRoot';
import FormField from '../components/common/FormField';
import SettingsRow from '../components/common/SettingsRow';
import SearchBar, { SearchCount } from '../components/common/SearchBar';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('../hooks/useAppTheme', () => () => ({ colors: {}, isDark: false }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

beforeEach(async () => { await act(async () => { await setLanguage('en'); }); });

test('mounted text and root switch RTL and back without remounting their children', async () => {
  let mounts = 0;
  function Content() {
    React.useEffect(() => { mounts += 1; }, []);
    return <Text testID="copy" style={{ fontSize: 16, lineHeight: 20 }}>Employee</Text>;
  }
  const screen = render(<LocaleRoot><Content /></LocaleRoot>);
  expect(StyleSheet.flatten(screen.getByTestId('copy').props.style).writingDirection).toBe('ltr');
  await act(async () => { await setLanguage('ar'); });
  // In RN an RTL Yoga tree maps textAlign:left to physical right/start.
  expect(StyleSheet.flatten(screen.getByTestId('copy').props.style)).toMatchObject({ writingDirection: 'rtl', textAlign: 'left', lineHeight: 24 });
  await act(async () => { await setLanguage('en'); });
  expect(StyleSheet.flatten(screen.getByTestId('copy').props.style).writingDirection).toBe('ltr');
  expect(mounts).toBe(1);
});

test('Arabic free text aligns RTL while password, phone and OTP data stay LTR', async () => {
  await act(async () => { await setLanguage('ar'); });
  const screen = render(<>
    <FormField label="Reason" value="" onChangeText={() => {}} multiline />
    <FormField label="Password" value="abc12345" onChangeText={() => {}} secureTextEntry />
    <FormField label="Phone" value="+97412345678" onChangeText={() => {}} keyboardType="phone-pad" />
    <FormField label="Code" value="123456" onChangeText={() => {}} textContentType="oneTimeCode" />
  </>);
  expect(StyleSheet.flatten(screen.getByLabelText('Reason').props.style).textAlign).toBe('right');
  for (const label of ['Password', 'Phone', 'Code']) {
    expect(StyleSheet.flatten(screen.getByLabelText(label).props.style)).toMatchObject({ textAlign: 'left', writingDirection: 'ltr' });
  }
});


test('directional chevrons mirror while universal glyphs and list counts keep their meaning', async () => {
  const screen = render(<SettingsRow title="Settings" icon="camera-outline" onPress={() => {}} />);
  expect(screen.UNSAFE_getAllByType('Ionicons').map(node => node.props.name)).toEqual(['camera-outline', 'chevron-forward']);
  await act(async () => { await setLanguage('ar'); });
  expect(screen.UNSAFE_getAllByType('Ionicons').map(node => node.props.name)).toEqual(['camera-outline', 'chevron-back']);
  screen.unmount();
  const count = render(<SearchCount matches={2} total={2} noun="notification" />);
  expect(count.getByText('إشعاران')).toBeTruthy();
  await act(async () => { await setLanguage('en'); });
  expect(count.getByText('2 notifications')).toBeTruthy();
});

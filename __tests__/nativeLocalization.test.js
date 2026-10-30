const fs = require('node:fs');
const path = require('node:path');
const { getResolvedLocalesAsync } = require('@expo/config-plugins/build/utils/locales');
const { expo } = require('../app.json');

const projectRoot = path.resolve(__dirname, '..');
const locales = ['en', 'ar'];
const permissionKeys = [
  'NSBarcodeScannerUsageDescription',
  'NSCameraUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSMotionUsageDescription',
  'NSPhotoLibraryUsageDescription',
];

test('Android locale generation excludes the iOS permission descriptions', async () => {
  const { localesMap } = await getResolvedLocalesAsync(projectRoot, expo.locales, 'android');

  expect(Object.keys(localesMap).sort()).toEqual([...locales].sort());
  locales.forEach(locale => {
    expect(localesMap[locale]).toEqual({});
  });
});

test.each(locales)('iOS locale generation preserves all committed %s permission descriptions', async locale => {
  const { localesMap } = await getResolvedLocalesAsync(projectRoot, expo.locales, 'ios');
  const committedStrings = fs.readFileSync(
    path.join(projectRoot, 'ios', 'ClaudionCheckin', `${locale}.lproj`, 'InfoPlist.strings'),
    'utf8',
  );
  const committedDescriptions = Object.fromEntries(
    [...committedStrings.matchAll(/"([^"]+)"\s*=\s*("(?:\\.|[^"\\])*");/g)]
      .map(([, key, value]) => [key, JSON.parse(value)]),
  );

  expect(Object.keys(committedDescriptions).sort()).toEqual([...permissionKeys].sort());
  expect(localesMap[locale]).toEqual(committedDescriptions);
});

const fs = require('node:fs');
const path = require('node:path');
const { updateAppDelegate, normalizeSceneManifest, selectAttendanceScene } = require('../plugins/withAttendanceBackgroundRuntime');

const migratedDelegate = fs.readFileSync(
  path.join(__dirname, '../ios/ClaudionCheckin/AppDelegate.swift'), 'utf8',
);
const template = migratedDelegate
  .replace(/^    AttendanceBackgroundRuntime\.shared\.configure\([^\n]+\)\n\n/m, '')
  .replace(/  \/\/ @generated begin claudion-attendance-scene-configuration[\s\S]*?  \/\/ @generated end claudion-attendance-scene-configuration\n\n/, '');

it('preserves Firebase, factory ownership and linking when adding background root reuse', () => {
  const result = updateAppDelegate(template);
  expect(result).toContain('AttendanceBackgroundRuntime.shared.configure(factory: factory, launchOptions: launchOptions)');
  expect(result).not.toContain('configurationForConnecting');
  expect(result.match(/FirebaseApp\.configure\(\)/g)).toHaveLength(1);
  expect(result).toContain('reactNativeFactory = factory');
  expect(result).toContain('super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  expect(result).toContain('RCTLinkingManager.application(app, open: url, options: options)');
  expect(result).toContain('RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)');
  expect(result).not.toContain('factory.startReactNative(');
});

it('can be reapplied without duplicating launch hooks or scene selection', () => {
  const first = updateAppDelegate(template);
  expect(updateAppDelegate(first)).toBe(first);
});

it('requires the scene migration before adding background startup', () => {
  expect(() => updateAppDelegate(template.replace(', ExpoReactNativeFactoryProvider', '')))
    .toThrow('supported scene lifecycle');
});

it('refuses to replace an existing app-owned scene configuration', () => {
  expect(() => updateAppDelegate(template.replace('  // Linking API', '  // configurationForConnecting\n  // Linking API')))
    .toThrow('existing AppDelegate scene configuration');
});

it('refuses to guess when custom launch forwarding no longer matches', () => {
  expect(() => updateAppDelegate(template.replace(
    'return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    'return true',
  ))).toThrow('custom AppDelegate launch forwarding');
});

const manifest = () => ({
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{
      UISceneConfigurationName: 'Default Configuration',
      UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
    }],
  },
});

it('reapplies Expo scene migration around the owned attendance subclass manifest', () => {
  const value = manifest();
  selectAttendanceScene(value);
  expect(value.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName)
    .toBe('ClaudionAttendanceSceneDelegate');
  normalizeSceneManifest(value);
  expect(value.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName)
    .toBe('EXExpoAppSceneDelegate');
  selectAttendanceScene(value);
  expect(selectAttendanceScene(value)).toEqual(value);
});

it('leaves unrelated scene delegates untouched during normalization and refuses to replace them', () => {
  const value = manifest();
  value.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName = 'OtherSceneDelegate';
  expect(normalizeSceneManifest(value)).toBe(value);
  expect(() => selectAttendanceScene(value)).toThrow('custom scene delegate');
});

it('requires review when the scene layout or multiple-scene policy differs', () => {
  const value = manifest();
  value.UIApplicationSupportsMultipleScenes = true;
  expect(() => selectAttendanceScene(value)).toThrow('custom scene manifest');
});

// Configuration contracts for the hand-maintained native project. These guards
// complement simulator/device tests; they do not establish OS callback delivery.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { default: plist } = require('@expo/plist');
const app = require('../app.json').expo;

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readPlist = (file) => plist.parse(read(file));
const info = readPlist('ios/ClaudionCheckin/Info.plist');
const updates = readPlist('ios/ClaudionCheckin/Supporting/Expo.plist');
const delegate = read('ios/ClaudionCheckin/AppDelegate.swift');

it('connects the scene manifest to the installed Expo scene runtime and factory provider', () => {
  const [major, minor, patch] = require('expo/package.json').version.split('.').map(Number);
  expect([major, minor]).toEqual([57, 0]);
  expect(patch).toBeGreaterThanOrEqual(23);
  const manifest = info.UIApplicationSceneManifest;
  expect(manifest.UIApplicationSupportsMultipleScenes).toBe(false);
  const configurations = manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
  expect(configurations).toHaveLength(1);
  expect(configurations[0].UISceneDelegateClassName).toBe('ClaudionAttendanceSceneDelegate');
  const expoRoot = path.dirname(require.resolve('expo/package.json'));
  const sceneRuntime = fs.readFileSync(
    path.join(expoRoot, 'ios/AppDelegates/ExpoAppSceneDelegate.swift'), 'utf8',
  );
  expect(sceneRuntime).toContain('@objc(EXExpoAppSceneDelegate)');
  expect(delegate).toMatch(/class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  expect(delegate).not.toContain('factory.startReactNative(');
  expect(delegate).not.toContain('UIScreen.main');
  expect(read('native/ios/AttendanceBackgroundRuntime.swift'))
    .toContain('final class AttendanceSceneDelegate: ExpoAppSceneDelegate');
  expect(read('ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift'))
    .toBe(read('native/ios/AttendanceBackgroundRuntime.swift'));
  const properties = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  expect(properties[1].ios.enableSceneSupport).toBe(true);
});

it('isolates SDK 57 OTA bundles while keeping the same app and Updates project', () => {
  expect(app.runtimeVersion).not.toBe('1.2.1');
  expect(updates.EXUpdatesRuntimeVersion).toBe(app.runtimeVersion);
  // Root Android is generated and ignored; fresh checkouts may not contain it.
  const androidStrings = 'android/app/src/main/res/values/strings.xml';
  if (fs.existsSync(path.join(root, androidStrings))) {
    expect(read(androidStrings)).toContain(
      `<string name="expo_runtime_version">${app.runtimeVersion}</string>`,
    );
  }
  expect(updates.EXUpdatesURL).toBe(app.updates.url);
  expect(updates.EXUpdatesEnabled).toBe(true);
  expect(updates.EXUpdatesCheckOnLaunch).toBe('ALWAYS');
  expect(updates.EXUpdatesLaunchWaitMs).toBe(0);
  expect(app.updates.url).toBe(`https://u.expo.dev/${app.extra.eas.projectId}`);
  expect(app.ios.bundleIdentifier).toBe('com.bazim.claudioncheckin');
  expect(app.android.package).toBe(app.ios.bundleIdentifier);
  expect(info.CFBundleShortVersionString).toBe(app.version);
  expect(info.CFBundleVersion).toBe(app.ios.buildNumber);
});

it('retains one Firebase initialization, APNs environments and notification background mode', () => {
  expect(delegate.match(/FirebaseApp\.configure\(\)/g)).toHaveLength(1);
  expect(info.UIBackgroundModes).toContain('remote-notification');
  expect(readPlist('ios/ClaudionCheckin/ClaudionCheckin.dev.entitlements')['aps-environment']).toBe('development');
  expect(readPlist('ios/ClaudionCheckin/ClaudionCheckin.entitlements')['aps-environment']).toBe('production');
  const project = read('ios/ClaudionCheckin.xcodeproj/project.pbxproj');
  expect(project).toContain('CODE_SIGN_ENTITLEMENTS = ClaudionCheckin/ClaudionCheckin.dev.entitlements;');
  expect(project).toContain('CODE_SIGN_ENTITLEMENTS = ClaudionCheckin/ClaudionCheckin.entitlements;');
  const digest = (file) => crypto.createHash('sha256').update(read(file)).digest('hex');
  expect(digest('ios/ClaudionCheckin/GoogleService-Info.plist')).toBe(digest('GoogleService-Info.plist'));
});

it('includes a motion purpose string in the shipped iOS plist and keeps Expo config aligned', () => {
  // expo-location links CoreMotion even when the app does not request motion
  // permission. EAS does not regenerate the committed native Info.plist.
  expect(typeof info.NSMotionUsageDescription).toBe('string');
  expect(info.NSMotionUsageDescription.trim()).not.toBe('');
  expect(info.NSMotionUsageDescription).toBe(app.ios.infoPlist.NSMotionUsageDescription);
});

it('keeps native geofence launch subscription and Android background receivers registered', () => {
  const moduleConfig = require('../modules/expo-auto-attendance/expo-module.config.json');
  expect(moduleConfig.apple.appDelegateSubscribers).toContain('AutoAttendanceAppDelegateSubscriber');
  expect(delegate).toContain('super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  const manifest = read('modules/expo-auto-attendance/android/src/main/AndroidManifest.xml');
  expect(manifest).toContain('expo.modules.autoattendance.GeofenceBroadcastReceiver');
  expect(manifest).toContain('expo.modules.autoattendance.GeofenceBootReceiver');
  expect(manifest).toContain('android.intent.action.BOOT_COMPLETED');
  expect(manifest).toContain('android.intent.action.MY_PACKAGE_REPLACED');
  expect(manifest).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
});

# Claudion-Checkin

Contributor setup, architecture, validation commands, and compatibility constraints are in [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) provides deeper domain rationale for both coding agents.

The QR/password and company-code/mobile sign-in methods are described in [Mobile sign-in](docs/mobile-sign-in.md), including lookup configuration and the staging checks required before rollout.

## Firebase Cloud Messaging (FCM)

This app now includes production-ready FCM client wiring for Android and iOS:

- Native Firebase app config files:
  - `google-services.json` (Android)
  - `GoogleService-Info.plist` (iOS)
- Android native setup:
  - Google services Gradle plugin enabled.
  - Default notification channel (`checkin_alerts`) created on startup.
  - Android 13 runtime notification permission support.
- JavaScript runtime setup:
  - Background message handler registration.
  - Foreground message listener with in-app toast.
  - Notification tap handling (`background` + `quit` state) with safe navigation.
  - Token refresh handling and local token cache.

### Optional backend token registration

If your backend supports registering device tokens, add this key to `expo.extra` in `app.json`:

```json
{
  "expo": {
    "extra": {
      "fcmRegistrationMethod": "employee_app.attendance_api.register_fcm_token"
    }
  }
}
```

You can also provide a full URL instead of a method path.

### iOS note

The `ios/` project is committed and contains native configuration. Use `npm run ios` for local builds; inspect any intentional prebuild changes before keeping them. In Xcode, ensure Push Notifications and Background Modes (Remote notifications) are enabled on the app target.

Keep `NSMotionUsageDescription` in both `app.json` and the committed
`ios/ClaudionCheckin/Info.plist`: the location SDK links Core Motion APIs even
though the app does not request motion permission. Its absence causes App Store
Connect error ITMS-90683. Fixing the submitted bundle requires a new native build
with an incremented iOS build number; an OTA cannot update the purpose string.

SDK 57 uses Node 22.14.0 (Volta / `.nvmrc` / EAS build profiles), React Native
0.86.3 and iOS 16.4 or newer. The maintained iOS project opts into Expo's scene
lifecycle for Xcode 27/iOS 27. Do not clean-prebuild the production native
folders. See [the native audit](docs/expo-native-upgrade-audit.md) and
[migration validation record](docs/expo-sdk57-migration.md).

After a framework upgrade, rebuild and install the native app with
`npm run android` or `npm run ios` before loading the new Metro bundle. An
Android emulator still running the SDK 54 / React Native 0.81.5 binary can fail
with `[runtime not ready]: ReferenceError: Property 'MessageQueue' doesn't exist`
when it receives SDK 57 / React Native 0.86.3 JavaScript. Installing the matching
native build resolves this mismatch; restarting Metro alone cannot update it.

## Crash reporting (Firebase Crashlytics)

`@react-native-firebase/crashlytics` (24.0.0, the same version as app/messaging) reports native crashes, uncaught JS errors and a few deliberately chosen non-fatal errors to the existing Firebase project.

- **Code:** everything goes through `services/crashlytics.service.js`; never import the package directly. The package creates its native module on import, so the service requires it lazily and turns every call into a no-op on binaries built before it (an OTA can deliver this JS to them).
- **Collection:** `firebase.json` enables release builds only (`crashlytics_debug_enabled: false`). To test from a debug build, set it to `true` and rebuild the native app.
- **Context:** a hashed employee ID (first 16 hex characters of SHA-256 of `<employee_code>@<tenant host>`), tenant host, sign-in method, current screen, UI mode and the running OTA update. No names, phone numbers, tokens or payloads. To find one employee's crashes: `printf '%s' 'HR-EMP-00042@acme.example.com' | shasum -a 256 | cut -c1-16`.
- **Native:** iOS uploads dSYMs from the `[CP-User] [RNFB] Crashlytics Configuration` build phase that `pod install` added. Android applies the Crashlytics Gradle plugin through the config plugin when EAS prebuilds the gitignored `android/`. Adding the package needs a new store build; an OTA alone leaves crash reporting inactive.
- **Local Android builds:** `npx expo prebuild --platform android` regenerates `android/` (SDK 57's prebuild cleans by default; `--no-clean` opts out). Never prebuild iOS: it would regenerate the committed `ios/` project.

### Verifying a build

Use an internal (`preview`) or development build, never Expo Go, and do not launch it from Xcode: Crashlytics cannot capture crashes while a debugger is attached.

1. Profile → **Crash reporting test** (shown only in development and `preview` builds) → **Record test non-fatal**. Close the app completely and reopen it; reports upload on the next launch.
2. Firebase console → Crashlytics → choose the platform → filter **Non-fatals**. `CRASHLYTICS_TEST_NON_FATAL` appears within a few minutes.
3. **Force native crash** → confirm. The app closes. Reopen it, then check **Crashes** for the new issue.
4. Check the stack traces: iOS frames should show symbols, not addresses. If the console reports a missing dSYM, the build phase did not upload it. Android Java/Kotlin frames are readable as-is because R8 is off; enabling it requires the mapping-file upload the plugin performs automatically.

## Testing EAS OTA updates on Android and iOS

This project is already configured for EAS Update:

- `expo-updates` is installed.
- `updates.url` points to the Expo project.
- `runtimeVersion` is an explicit string in `app.json`; iOS reads `EXUpdatesRuntimeVersion` from `ios/ClaudionCheckin/Supporting/Expo.plist`.
- EAS build channels are defined in `eas.json`.

The SDK 57 binary uses runtime `1.2.1-sdk57`, separate from existing SDK 54
runtime `1.2.1`. Publish SDK 57 bundles only for the new runtime. SDK 55+ also
requires an explicit EAS environment when publishing; the update scripts select
`preview` or `production`. Ensure that environment contains the intended public
lookup configuration before publishing. No update is published by local tests.

When you bump the app version, keep the runtime version in `app.json` and the native Expo update config aligned. Review the [versioning guide](CLAUDE.md#versioning-gotcha): the committed iOS project does not automatically receive `app.json` changes. Changes to native modules or native configuration require a new binary.

Use a real EAS build to test OTA updates. Expo Go will not receive updates from your project channel.

### 1. Install a build on the channel you want to test

For preview testing on both platforms:

```bash
npm run eas:build:preview
```

If you want one platform only:

```bash
npm run eas:build:android:preview
npm run eas:build:ios:preview
```

For production-style testing, install builds created with:

```bash
eas build --profile production --platform android
eas build --profile production --platform ios
```

### 2. Make a JavaScript-only change

Change something visible in the app, for example text on the Profile screen or Home screen.

Do not change native configuration for an OTA test.

### 3. Publish the OTA update to the matching channel

For preview on both Android and iOS:

```bash
npm run eas:update:preview -- --message "Test OTA update"
```

If you want one platform only:

```bash
npm run eas:update:android:preview -- --message "Android OTA test"
npm run eas:update:ios:preview -- --message "iOS OTA test"
```

For production on both platforms:

```bash
npm run eas:update:production -- --message "Production OTA update"
```

### 4. Verify inside the app

Open the Profile screen and check the OTA Updates card:

- Channel should match the build channel.
- Runtime should match the update's intended native runtime.
- Update ID changes after a new OTA update is applied.

Tap `Check for OTA update` to fetch and apply the latest update manually.

### Notes

- OTA compatibility uses the explicitly configured runtime version; this repository does not use `runtimeVersion.policy: appVersion`.
- Changing `expo.version` alone does not change OTA targeting. Updates for a new runtime are not eligible for installed builds on the old runtime.
- If an update does not appear, verify that the installed binary and published update use the same channel and runtime version.
- The same JS update can be published to both platforms together, but only if both installed binaries are on a compatible runtime version.

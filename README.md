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

SDK 57 uses Node 22.14.0 (Volta / `.nvmrc` / EAS build profiles), React Native
0.86.3 and iOS 16.4 or newer. The maintained iOS project opts into Expo's scene
lifecycle for Xcode 27/iOS 27. Do not clean-prebuild the production native
folders. See [the native audit](docs/expo-native-upgrade-audit.md) and
[migration validation record](docs/expo-sdk57-migration.md).

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

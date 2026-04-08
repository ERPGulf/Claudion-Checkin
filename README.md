# Claudion-Checkin

## Testing EAS OTA updates on Android and iOS

This project is already configured for EAS Update:

- `expo-updates` is installed.
- `updates.url` points to the Expo project.
- `runtimeVersion.policy` is set to `appVersion`.
- EAS build channels are defined in `eas.json`.

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
- Runtime should match the app version runtime.
- Update ID changes after a new OTA update is applied.

Tap `Check for OTA update` to fetch and apply the latest update manually.

### Notes

- Because `runtimeVersion.policy` uses `appVersion`, OTA updates only apply to builds with the same app version.
- If you bump `expo.version`, older builds will not receive the new OTA update.
- If an update does not appear, verify that the installed binary and published update use the same channel and runtime version.
- The same JS update can be published to both platforms together, but only if both installed binaries are on a compatible runtime version.

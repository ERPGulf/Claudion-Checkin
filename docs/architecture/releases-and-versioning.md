# Releases and versioning

## Versioning gotcha

`ios/` is committed but `android/` is gitignored, so the two platforms read versions from different places and **app.json is not authoritative for iOS**. `expo-doctor` warns about this ("app config fields that may not be synced in a non-CNG project"): with `ios/` present, EAS Build does not sync the `ios` config block, so anything iOS-related must be edited in the native project by hand.

Bumping a version means reviewing these fields; read current values from the files rather than copying versions from documentation:

| File | Field | Applies to |
| --- | --- | --- |
| `package.json` | `version` | bookkeeping |
| `app.json` | `expo.version` | Android (+ JS via `Constants.expoConfig`) |
| `app.json` | `expo.runtimeVersion` | Android OTA targeting |
| `app.json` | `expo.android.versionCode` | Android (EAS prebuilds `android/`) |
| `ios/ClaudionCheckin/Info.plist` | `CFBundleShortVersionString` + `CFBundleVersion` | **iOS — app.json `ios.buildNumber` is ignored** |
| `ios/ClaudionCheckin/Supporting/Expo.plist` | `EXUpdatesRuntimeVersion` | **iOS OTA targeting — app.json `runtimeVersion` is ignored** |

Miss `Expo.plist` and the new iOS build silently announces the *old* runtime version: it will pull OTA updates meant for the previous release and never receive updates published for its own. Keep `app.json`'s iOS values in sync anyway so the two don't disagree, but the plists are what ship.

Also note: `constants/appInfo.js` exports a stale `app_version` (`1.0.1`) and is **dead code** — nothing imports it. The Profile screen reads `Constants.nativeAppVersion ?? Constants.expoConfig?.version`.

`eas.json` sets `appVersionSource: "local"` (versions come from the repo, not EAS servers) and `requireCommit: true` (builds need a clean working tree).

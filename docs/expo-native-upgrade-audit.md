# Expo / Xcode 27 native upgrade audit

Audit date: 2026-10-06. Starting commit: `33efebf`, branch `feat/new-auth`.
The working tree was clean before work began. No automatic commits, publishing,
or production native regeneration are part of this migration.

## Starting state and target

- Expo 54.0.37, React Native 0.81.5, React 19.1.0.
- Expo CLI 54.0.27 (nested dependency), build-properties 1.0.10.
- RNFirebase app and messaging 24.0.0; Firebase Apple SDK 12.10.0.
- App 1.2.1, iOS build 13, Android version code 22.
- Bundle/application ID `com.bazim.claudioncheckin`.
- Xcode 27.0 / 27A266a, CocoaPods 1.16.2, Java 17.0.19.
- Default Node is 20.19.4; Node 22.14.0 is already installed through Volta.
- `ios/` is committed; root `android/` exists locally but is ignored by Git.
- Registry on the audit date: `latest` = Expo 57.0.26, `next` = 58.0.5.
  SDK 58 is documented as beta with RN 0.88 RC. The user selected SDK 57
  stable with the supported scene opt-in after reviewing this distinction.

## Native ownership and regeneration hazards

| Area | Origin / ownership | Preservation requirement |
| --- | --- | --- |
| AppDelegate factory, bundle URL, URL and activity forwarding | Expo SDK 54 template | Manually merge supported factory/scene migration; keep `super` forwarding. |
| `FirebaseCore` import and `FirebaseApp.configure()` | RNFirebase app config plugin; generated marker in AppDelegate | Configure exactly once before Expo launch subscribers / scene startup. |
| Info.plist permissions, splash, appearance, new architecture | Expo and package plugins, committed native output | Add only required scene entries; preserve existing descriptions and values. |
| Info.plist version/build and native URL scheme | Hand-maintained committed output | Preserve 1.2.1 / 13 and `com.bazim.claudioncheckin`. Native iOS scheme differs from app config's `claudioncheckin`; do not silently replace. |
| Podfile | Expo template plus manual post-install minimum-deployment-target clamp | Preserve clamp and static frameworks; merge SDK-required Podfile changes. |
| Podfile.properties.json | Build-properties plugin output | Preserve RNFB static-linking list, Hermes, privacy aggregation. |
| Separate Debug/Release entitlements and Xcode references | Hand-maintained | Keep development/production APS environments and team ID. |
| Firebase config files / Xcode resource | RNFirebase plugin and committed files | Preserve files and target resource membership. Do not log contents. |
| Expo.plist / EAS configuration | Updates plugin output plus manually synchronized runtime | Preserve update project/URL/channels/launch behavior; isolate the upgraded native runtime before any OTA publication. |
| `modules/expo-auto-attendance/ios/*.swift` | Manually maintained local Expo module | Never regenerate or replace; preserve Core Location and persistence contracts. |
| Local module subscriber registration and podspec | Manually maintained Expo module metadata | Keep autolinking and launch subscriber; raise podspec target only if SDK requires it. |
| Android MainApplication / MainActivity / Gradle | SDK 54 template and splash/Firebase plugin output | Merge native upgrade helper changes in place; preserve lifecycle dispatch, namespace and splash. |
| Android app manifest | Expo/package plugin output and local state | Preserve background location, foreground service location, notification, boot permissions; `singleTask`, `adjustPan`, portrait, URL scheme, Updates metadata. |
| Local Android module, manifest, receivers and Gradle | Manually maintained | Preserve ENTER/EXIT receiver and boot/package-replaced restoration; never replace native geofencing sources. |

No app-local config plugins, patch-package patches, extra Swift sources in the
app target, or associated-domain entitlements were found. Existing config
plugins are RNFirebase app/messaging, location, camera, build-properties, font,
asset and notifications. `app.config.js` selects APS entitlement by build profile.

A clean prebuild would lose the Podfile clamp, separate entitlement setup,
native-only URL scheme, and potentially native-only Android permissions and
settings. It would also rewrite committed Updates/version settings. The local
module is outside the native folders, but that alone does not make a clean
production regeneration safe. Use temporary template projects and manual merges.

## Lifecycle and background contracts

AppDelegate has exactly three overrides: launch, URL opening, and continuing
user activity. Launch creates/binds the React Native factory, creates `UIWindow`,
configures Firebase once, starts React Native, then calls Expo's superclass.
There are no app-local foreground/background, APNs registration, remote-fetch,
or notification-center delegate overrides.

RNFirebase observes application launch, installs APNs/Firebase/notification
delegates and swizzling, registers for remote notifications, handles remote
fetch completion and background JS delivery, and preserves the original
notification-center delegate. These process-level notification hooks still
belong to AppDelegate / UNUserNotificationCenter under UIScene. Its old root-view
lookup uses AppDelegate.window: inspect Expo's compatibility window and
background startup behavior before accepting the scene migration.

`AutoAttendanceAppDelegateSubscriber` is autolinked through
`apple.appDelegateSubscribers`. On launch with persisted monitoring active,
it primes `GeofenceManager` before JS. The manager owns `CLLocationManager`,
region registration, initial-state request/retries and synthetic ENTER,
ENTER/EXIT callbacks, Always/precise permission checks, and low-power warnings.
`GeofenceStore` persists configuration and the last transition before event
emission. JS replays eligible events through `AutoAttendanceBootstrap`, with
age/high-water guards and the shared attendance-session lock. These stay in
the module/subscriber rather than being duplicated in a scene delegate.

Android Play Services delivers ENTER/EXIT to `GeofenceBroadcastReceiver`;
it persists then emits. `GeofenceBootReceiver` restores registration after boot
and package replacement. Power-save observation is dynamically registered by
the Expo module. Receivers and permissions merge from its library manifest.

App.js installs guarded native crypto, registers the FCM background handler
at module load, hydrates persisted state/preferences, mounts attendance/feature
bootstraps, and checks Updates on startup. FCM service owns token/topic cleanup,
foreground receipt, background receipt, tap and initial-notification routing.
Local notifications use expo-notifications independently.

Offline synchronization is JS/AppState/transport-driven; no Expo TaskManager or
OS background-task package is installed. SQLite queue/migration, durable session
state, request contracts, token refresh, manual online-only attendance, native
event replay and auth hydration must remain behaviorally unchanged.

## Configuration differences and existing limitations

- iOS background modes contain `remote-notification` only. Current geofencing
  uses region monitoring, not continuous background location updates; do not
  add a continuous-location mode mechanically.
- No associated domains are currently configured in either entitlement file.
- Project marketing/current-version build settings are stale (1.0 / 1), while
  Info.plist contains the actual shipped 1.2.1 / 13. Preserve shipped fields.
- Root Android release signing uses the existing debug placeholder; a local
  release build is compilation validation, not a store-signed artifact.
- No Android SDK was found at the default user location; check other configured
  locations before declaring an Android build blocked.
- Initial simulator access failed under the sandbox. Retry build/device tools
  with required access before concluding launch verification is unavailable.
- Jest baseline: 79 suites / 1,835 tests passed. Existing warnings: stale
  `.git-rewrite` haste collision and an asynchronous handle that keeps Jest alive.

## Snapshot and migration plan

Snapshot of ios (excluding Pods/build), Android (excluding caches/build), local
modules and package/config files:
`/private/tmp/claudion-sdk54-audit-re1pn5g9`.

Proceed through 54 -> 55 -> 56 -> 57 packages. At each step run dependency fixing
and Doctor, record dependency/native template diffs and investigate real peer
conflicts without force flags. Compare Expo's native upgrade helper/templates
for every transition, then manually merge cumulative native changes. SDK 56+
requires iOS 16.4 and Node 22.13+. SDK 57.0.26 includes the scene runtime backport
and resolved Hermes memory/startup regressions.

Sources: [SDK 55](https://expo.dev/changelog/sdk-55),
[SDK 56](https://expo.dev/changelog/sdk-56),
[SDK 57](https://expo.dev/changelog/sdk-57),
[SDK 58 beta](https://expo.dev/changelog/sdk-58-beta),
[native upgrade helper](https://docs.expo.dev/bare/upgrade/),
[Expo scene lifecycle guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md),
[RNFirebase setup](https://rnfirebase.io/),
[messaging](https://rnfirebase.io/messaging/usage).

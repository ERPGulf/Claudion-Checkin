# SDK 54 -> SDK 57 migration record

See [the pre-change native audit](expo-native-upgrade-audit.md) for ownership,
callback inventory, original settings and the external native snapshot.
SDK 57 stable was selected by the user; SDK 58 was evaluated but is currently
the registry's `next` release and documented as beta with React Native 0.88 RC.

## Stage 54 -> 55

Expo 55.0.31, React Native 0.83.10, React 19.2.0.

Changed `package.json` / `package-lock.json` using `npm install expo@~55.0.31`
and `CI=1 npx expo install --fix`. React test renderer was aligned explicitly
with React because Expo does not include it in bundledNativeModules.json.
No force or legacy-peer-deps flags were used. RNFirebase stayed at 24.0.0.

Native changes from the official upgrade helper and current published templates:

- `ios/ClaudionCheckin/AppDelegate.swift`: `internal import Expo`, `@main`,
  internal class visibility and removal of obsolete factory binding. Firebase's
  generated initialization block and both linking overrides retained.
- `ios/Podfile`: mandatory new architecture and supported RN/Hermes environment
  setup; custom post-install minimum target clamp retained.
- `android/app/build.gradle`: resolve Hermes through `hermes-compiler`.
- `android/app/src/main/java/com/bazim/claudioncheckin/MainApplication.kt`:
  use `ExpoReactHostFactory`, preserving application/configuration lifecycle
  dispatch and autolinked packages.
- `android/gradle/wrapper/gradle-wrapper.properties`: Gradle 9.0.0 intermediate
  target. The reviewed current wrapper executable/JAR was taken from the
  published template, rather than modifying its binary by hand.
- `android/app/src/main/AndroidManifest.xml`: cap legacy storage permissions at
  API 32 and retain all existing location/notification/boot permissions.
- `app.json`: add datetimepicker/image/sqlite plugins explicitly requested by
  Expo installation. The first fix attempt stopped on the dynamic-config write;
  plugins were added by hand and the alignment rerun successfully.
- `jest.config.js`: resolve Expo core and its internal polyfill through the
  installed Expo package, which npm may nest rather than hoist. Exclude the
  stale `.git-rewrite` tree from module discovery as well as test discovery.
- `jest.setup.js`: supply native-runtime-equivalent TextEncoder/TextDecoder in
  jsdom for Expo's URL implementation. Real lookup decoder tests still import
  and exercise Expo's TextDecoder.

Validation: `npx expo-doctor` passed 19/20 checks. The sole warning is unsynced
app config in a project with maintained native folders; it is retained and
addressed by manual native/config review, not disabled. Focused auth session,
auth flow matrix, real lookup codec, attendance queue and FCM regressions passed
(5 suites, 110 tests). Ruby Podfile syntax passed. Initial focused test attempts
identified the Jest module-resolution/encoding failures above; these were fixed
before proceeding. Full native builds are deferred to the final SDK because
intermediate SDKs do not support this machine's required iOS 27 lifecycle.

## Stage 55 -> 56

Expo 56.0.23 was installed and Expo dependency alignment started. Registry
transfers for the SDK 56 precompiled camera/image/SQLite binaries repeatedly
stalled or reset. The SDK 56 package-install stage was not completed, and no SDK
56 Doctor/test pass is claimed.

The remaining 56 package alignment and 56 -> 57 package transition were combined.
The official 56 -> 57 native helper has no additional baseline template changes;
all 55 -> 56 native requirements below were merged independently. Final SDK 57
versions came from its published compatibility table, with `expo install --fix`
then completing the Babel/TypeScript alignment. Final Doctor, Metro, Jest and
both native builds validate the resulting graph. Registry archives reused from
cache retained their published integrity checks. Interrupted npm staging folders
were moved out of the project; no production native directory was deleted.

Native template requirements: iOS minimum 16.4, Hermes v1 by default,
precompiled Expo modules setup, Gradle 9.3.1. Applied to `ios/Podfile`,
`ios/Podfile.properties.json`, all four Xcode deployment-target settings,
the local `ExpoAutoAttendance.podspec`, app config and the Android Gradle wrapper
property. No Swift geofence manager, module subscriber, native store, event bus,
Kotlin receiver, bridge API or attendance logic was replaced.

The Android activity's `smallestScreenSize` config-change entry was also merged
from the 54 -> 55 upgrade helper; existing `singleTask`, portrait and `adjustPan`
settings remain.

Risks: devices below iOS 16.4 cannot install the new binary. The SDK changes
default fetch to expo/fetch and defaults to Hermes v1. This project already uses
expo/fetch explicitly for auth SDK calls. SDK 56's known Hermes/worklet memory
regression makes it an intermediate stage only; the SDK 57 patches resolve it.

## Sources and comparison artifacts

The official [Native Project Upgrade Helper](https://docs.expo.dev/bare/upgrade/)
diff data was inspected for 54..55, 55..56 and 56..57, along with published
`expo-template-bare-minimum` SDK tags. Helper diffs and the current templates are
saved under `/private/tmp/claudion-expo-templates`. 56 -> 57 has no additional
baseline native-template changes; scene opt-in is a separate SDK 57 patch
migration. The published 57.0.26 scene runtime and 57.0.22 build-properties plugin
were inspected independently before editing the app's scene setup.

All package/build commands use the existing Node 22.14.0 binary. Package
installation and Doctor require network access; simulator/build tools require
access to Apple/Gradle caches beyond the workspace sandbox.

## Installed package changes

Versions below are from the original and final npm lockfiles. RNFirebase app and messaging remain pinned to 24.0.0. No forced installs or peer-check bypasses were used.

| Direct package | SDK 54 | SDK 57 |
| --- | --- | --- |
| `@babel/core` | 7.28.5 | 7.29.7 |
| `@react-native-community/datetimepicker` | 8.4.4 | 9.1.0 |
| `@react-native-community/netinfo` | 11.4.1 | 12.0.1 |
| `@react-native-picker/picker` | 2.11.1 | 2.11.4 |
| `babel-preset-expo` | 54.0.10 | 57.0.13 |
| `expo` | 54.0.37 | 57.0.27 |
| `expo-asset` | 12.0.13 | 57.0.19 |
| `expo-blur` | 15.0.8 | 57.0.3 |
| `expo-build-properties` | 1.0.10 | 57.0.22 |
| `expo-camera` | 17.0.10 | 57.0.6 |
| `expo-checkbox` | 5.0.8 | 57.0.0 |
| `expo-constants` | 18.0.14 | 57.0.21 |
| `expo-crypto` | 15.0.9 | 57.0.3 |
| `expo-device` | 8.0.10 | 57.0.2 |
| `expo-document-picker` | 14.0.8 | 57.0.3 |
| `expo-font` | 14.0.12 | 57.0.4 |
| `expo-haptics` | 15.0.8 | 57.0.3 |
| `expo-image` | 3.0.11 | 57.0.5 |
| `expo-image-picker` | 17.0.11 | 57.0.20 |
| `expo-location` | 19.0.8 | 57.0.20 |
| `expo-notifications` | 0.32.17 | 57.0.22 |
| `expo-splash-screen` | 31.0.13 | 57.0.9 |
| `expo-sqlite` | 16.0.10 | 57.0.4 |
| `expo-status-bar` | 3.0.9 | 57.0.1 |
| `expo-updates` | 29.0.20 | 57.0.25 |
| `jest-expo` | 54.0.18 | 57.0.5 |
| `react` | 19.1.0 | 19.2.3 |
| `react-native` | 0.81.5 | 0.86.3 |
| `react-native-gesture-handler` | 2.28.0 | 2.32.0 |
| `react-native-reanimated` | 4.1.6 | 4.5.1 |
| `react-native-safe-area-context` | 5.6.2 | 5.7.0 |
| `react-native-screens` | 4.16.0 | 4.26.2 |
| `react-native-worklets` | 0.5.1 | 0.10.1 |
| `react-test-renderer` | 19.1.0 | 19.2.3 |
| `typescript` | 5.9.3 | 6.0.3 |

## Stage 56 -> 57 and supported scene opt-in

Final versions: Expo **57.0.27**, React Native **0.86.3**, React **19.2.3**,
Expo CLI **57.0.28**,
build-properties **57.0.22**, RNFirebase app/messaging **24.0.0**.
Node **22.14.0** is pinned in Volta, `.nvmrc` and EAS build profiles; SDK 57
requires Node >=22.13.0. The ignored local Xcode Node override pointed at Node
20.19.4 and was updated to this machine's installed Node 22 binary.

### Changes and reasons

- `app.json`: supported `ios.enableSceneSupport: true`, SDK plugin additions,
  iOS 16.4 minimum, and splash settings moved to the supported splash-screen
  plugin. The legacy full-screen image/cover/white background is retained;
  the production storyboard/assets were not regenerated.
- `AppDelegate.swift`: factory ownership/provider conformance, one Firebase
  configure call, launch subscriber forwarding and both linking overrides.
  Window creation and normal React startup belong to Expo's scene delegate.
- `Info.plist`: single-scene manifest referencing `ClaudionAttendanceSceneDelegate`,
  a subclass of Expo's supported scene delegate, for new and restored sessions.
  Existing versions, permissions, schemes and background modes remain.
- `native/ios/AttendanceBackgroundRuntime.swift` and its generated copy
  `ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift`: background startup
  adapter and a small `ExpoAppSceneDelegate` subclass for root reuse.
- `plugins/withAttendanceBackgroundRuntime.js`: recreates the adapter, Xcode
  source membership, manifest and AppDelegate launch hook; refuses unknown custom
  launch/scene configurations. Its main app-config entry precedes build-properties; a normalization-only entry
  follows it. Expo executes the chained mods in reverse registration order, so
  normalization exposes Expo's owned manifest first, the supported scene converter
  runs next, and the main plugin selects the subclass last. Unknown delegates
  and multi-scene layouts are refused. Temporary regeneration and reapplication
  were verified.
- `GeofenceEventBus.swift`: posts a payload-free native wake notification for
  ENTER/EXIT before emitting the existing JS event. GeofenceManager persists
  the event before this call; its algorithms, initial ENTER, store and module
  APIs remain unchanged.
- `modules/expo-auto-attendance/index.js`: import the same optional native API
  through Expo's supported public export. Direct `expo-modules-core` was removed
  from package.json in response to Doctor; Expo still installs its required core.
- `Podfile`, properties, local module podspec and Xcode targets: SDK 56/57
  requirements and minimum 16.4. Existing custom minimum-pod-target clamp retained.
- `Podfile.lock` / Xcode project: CocoaPods' React Native 0.86, Hermes v1 and
  precompiled Expo framework/resource integration. An explicit update of the
  two RN binary pods resolved CocoaPods retaining the locked 0.81 framework.
- `app.json`, native `Supporting/Expo.plist` and generated Android strings:
  runtime becomes **1.2.1-sdk57** so new native modules cannot receive SDK 54
  bundles. App version 1.2.1, build numbers, identifiers, Updates URL/project,
  startup policy and EAS channels are retained.
- `package.json` / README: OTA scripts select the preview/production EAS
  environment required since SDK 55; nothing was published.
- `metro.config.js`: exclude the stale `.git-rewrite` snapshot using the standard
  Expo Metro config. Existing Babel/ERPGulf transforms remain.
- Jest configuration/setup and new native/plugin guards: resolve nested Expo
  dependencies, preserve real lookup decoding, exclude scratch files and check
  preservation/idempotency/refusal of unknown AppDelegate configurations.

### Final SDK 57 patch alignment

Doctor detected the October 6 patch set during final verification. Expo was
updated from 57.0.26 to **57.0.27**, CLI to **57.0.28**, asset to **57.0.19**,
constants to **57.0.21**, notifications to **57.0.22**, SQLite to **57.0.4** and
Updates to **57.0.25**. ExpoModulesCore's transitive/native version is **57.0.21**.
The SQLite patch fixes statement result reuse/locking, notifications permits
retry after a transient native token request failure, and core includes listener
cleanup/reload fixes. App attendance/auth APIs were not changed for these fixes.

Newly published versions initially appeared missing because the temporary npm
cache held old registry metadata. Refreshing those entries resolved the errors.
The completed install used normal dependency resolution; `npm ls --all` reports
no dependency problems. Final package alignment, Doctor, full Jest, both Hermes
exports and Android build were repeated on this patch set.

The scene delegate, React factory and Updates AppController sources used by the
adapter are byte-identical between the earlier and final patches. Native app
source required no further lifecycle changes. CocoaPods needed a targeted update
of the ten changed Expo pods before normal `pod install` succeeded (130 pods).

One local Debug rebuild failed with missing React `Sealable` symbols. Archive
hash comparisons showed both installed RN binary pods were still Release variants,
while their configuration markers were missing after pod regeneration. RN's
upstream switch scripts assume Debug when those markers are absent. Running the
unmodified scripts through Release then Debug restored the correct artifacts and
markers; normal pod install preserved them, and the subsequent Debug build passed.
Only generated pod frameworks were swapped. No source flags, dependency checks,
picker implementation or production native directory was replaced.

### Exact native file changes

Maintained iOS/module paths:

- `ios/ClaudionCheckin/AppDelegate.swift`
- `ios/ClaudionCheckin/Info.plist`
- `ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift` (new, plugin-owned copy)
- `ios/ClaudionCheckin/Supporting/Expo.plist`
- `ios/ClaudionCheckin.xcodeproj/project.pbxproj`
- `ios/Podfile`
- `ios/Podfile.properties.json`
- `ios/Podfile.lock`
- `modules/expo-auto-attendance/ios/ExpoAutoAttendance.podspec`
- `modules/expo-auto-attendance/ios/GeofenceEventBus.swift`
- `native/ios/AttendanceBackgroundRuntime.swift` (new, canonical source)

The source recreation/merge plugin is `plugins/withAttendanceBackgroundRuntime.js`.
The ignored local `ios/.xcode.env.local` was aligned with the installed Node 22.
Firebase files, entitlement files and the other custom Swift/Kotlin module
implementations were preserved.

Root Android is ignored; snapshot comparison identifies these exact in-place changes:

- `android/app/build.gradle`
- `android/build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/bazim/claudioncheckin/MainApplication.kt`
- `android/app/src/main/res/values/strings.xml`
- `android/gradle/wrapper/gradle-wrapper.properties`
- `android/gradle/wrapper/gradle-wrapper.jar`
- `android/gradlew`
- `android/gradlew.bat`

### Background lifecycle details

Expo 57's built-in scene delegate starts React when a scene connects. Native
region/remote notification launches can occur without a UI scene. Merely moving
all startup into that callback would leave the native geofence event persisted
but could delay JS attendance/FCM background processing until a user opens the app.

The adapter listens for the module's native transition and the notification
`RNFBMessagingDidReceiveRemoteNotification`, verified in RNFirebase 24's native
source. It does not take over APNs/UNUserNotificationCenter delegates or RNFirebase
fetch completion handlers. This RNFirebase notification name is an implementation
coupling that must be reviewed when RNFirebase is upgraded.

It starts only for a background wake with no connected scene and no mirrored
window, once per process. A bounded background task covers startup. Release
selection uses the original Expo Updates AppController and its cached/embedded
bundle URL; Debug uses Metro. The public Expo factory creates and retains the
React root without a legacy UIWindow. When a scene connects, the subclass reuses
that root in `UIWindow(windowScene:)`. Normal launches call the inherited Expo
connection implementation. URL/activity/quick-action and foreground/background
callbacks use inherited Expo forwarding; no UIKit lifecycle notifications are
manually reposted. The singleton retains the root to avoid mounting App twice.

A final manifest probe logged exactly one background root and then
`Reusing background React root for scene`. An earlier callback-only selection
was insufficient for cached scene sessions; it was replaced with the explicit
subclass manifest.

Final snapshot comparisons confirm that GeofenceManager, GeofenceStore,
AutoAttendanceAppDelegateSubscriber, ExpoAutoAttendanceModule, the Android
GeofenceBroadcastReceiver, GoogleService-Info.plist and both APS entitlement files
are byte-identical to their original versions. Removing the newly added scene
manifest from the parsed Info.plist produces exactly the original dictionary.

A DEBUG-only simulator environment probe (`CLAUDION_TEST_BACKGROUND_STARTUP=1`)
exercises this windowless startup and subsequent scene attachment. It is excluded
from Release. The probe validates this code path, not Apple's real geofence/APNs
wake delivery. Physical-device cold background tests remain a rollout gate.

### Firebase, notifications and Android

RNFirebase package versions are pinned at 24.0.0 and Firebase iOS pods remain
at 12.10.0; Firebase config files and APS
entitlements were preserved. Firebase initializes exactly once in AppDelegate,
before the native launch subscribers. Swizzling and notification handlers remain
in their original libraries; app token/topic/permission/message/tap logic is unchanged.

Root Android is ignored/generated. In-place changes are Hermes resolution,
ExpoReactHostFactory with lifecycle dispatch, Gradle wrapper 9.3.1 and its reviewed
wrapper files, legacy storage caps, smallestScreenSize configuration, Google
Services plugin **4.4.4** (the installed RNFirebase plugin's generated version),
and the new runtime string. Native Kotlin geofence/boot receivers, permissions,
manifest merges, package ID, activity settings and JS logic remain.

The audit snapshot remains at `/private/tmp/claudion-sdk54-audit-re1pn5g9`.
Temporary SDK 57 projects are at `/private/tmp/claudion-sdk57-comparison`.
A production clean prebuild is still unsafe: existing custom Podfile/entitlement/
scheme/project settings are manually maintained. The new adapter plugin alone
does not prove all existing customizations can be regenerated.

### API review and risks

Used camera/scan/image-picker/document-picker/location/notification/SQLite/Updates
APIs were inspected against the installed packages. The app already uses the
current CameraView and async SQLite interfaces. SDK 55's renamed blur prop occurs
only in a comment and an assertion; no affected production prop call exists.
No unused breaking API was mechanically changed. Production bundles compile for
both platforms; actual permission/media/native storage behavior needs devices.
SDK 56+ defaults to Expo fetch and Hermes v1; the auth SDK already explicitly
uses Expo fetch, and all auth/lookup contract tests pass. No cold-boot auth call
was added. The iOS minimum increase excludes devices below 16.4.

### Commands and verification

Commands run from the repository unless noted; logs are under `/private/tmp/claudion-*`.

```sh
npm install expo@~55.0.31
CI=1 npx expo install --fix
npx expo-doctor
npm install expo@~56.0.23
# SDK 56 fix was interrupted by registry failures; combined final alignment above.
npm install --prefer-offline --maxsockets=4 --fetch-timeout=120000 --fetch-retries=2
CI=1 EXPO_NO_DOTENV=1 npx expo install --fix
npm install expo@~57.0.27 --cache /private/tmp/claudion-npm-cache --prefer-online --maxsockets=4 --fetch-timeout=120000 --fetch-retries=2
EXPO_NO_DOTENV=1 CI=1 npm_config_cache=/private/tmp/claudion-npm-cache npm_config_prefer_offline=true npx expo install --fix
EXPO_NO_DOTENV=1 CI=1 npx expo install --check
EXPO_NO_DOTENV=1 CI=1 npx expo-doctor
npm ls --all --json
npm test -- --runInBand --watchman=false --silent
EXPO_NO_DOTENV=1 CI=1 npx expo export --platform ios --platform android --output-dir /private/tmp/claudion-sdk57-export
# Temporary comparison directory only:
EXPO_NO_DOTENV=1 CI=1 npx expo prebuild --no-install
# Maintained ios project:
pod install
pod update React-Core-prebuilt ReactNativeDependencies --no-repo-update
pod update Expo ExpoModulesCore ExpoModulesWorklets ExpoModulesWorkletsAdapter ExpoAsset EXConstants ExpoNotifications ExpoSQLite EXUpdates EASClient --no-repo-update
# Generated binary configuration recovery, from ios/Pods, if markers were lost:
node ../../node_modules/react-native/scripts/replace-rncore-version.js -c Release -r 0.86.3 -p "$PWD"
node ../../node_modules/react-native/scripts/replace-rncore-version.js -c Debug -r 0.86.3 -p "$PWD"
node ../../node_modules/react-native/third-party-podspecs/replace_dependencies_version.js -c Release -r 0.86.3 -p "$PWD"
node ../../node_modules/react-native/third-party-podspecs/replace_dependencies_version.js -c Debug -r 0.86.3 -p "$PWD"
EXPO_NO_DOTENV=1 CI=1 npx expo run:ios --device 4DB36096-7AA0-4580-A644-88105CF9572B --no-bundler
# From android:
./gradlew :app:assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a
# Unsigned device Release compilation; no distribution:
EXPO_NO_DOTENV=1 CI=1 xcodebuild -workspace ios/ClaudionCheckin.xcworkspace -scheme ClaudionCheckin -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/claudion-sdk57-release-build CODE_SIGNING_ALLOWED=NO build
# Signed Release using existing local settings; no provisioning updates:
EXPO_NO_DOTENV=1 CI=1 xcodebuild -workspace ios/ClaudionCheckin.xcworkspace -scheme ClaudionCheckin -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/claudion-sdk57-release-build build
```

No force/legacy-peer-deps, automatic audit fixes, commits, EAS builds or updates,
submissions or production native clean prebuilds were performed.

## Validation results

- Original SDK 54 full Jest baseline: **79 suites / 1,835 tests passed**.
- SDK 55 focused validation: **5 suites / 110 tests passed**.
- SDK 57 full suite including final scene-manifest/plugin guards:
  **81 suites / 1,847 tests passed**, repeated on the final patch set. Jest's
  existing open-handle warning remains; the final run subsequently exited 0.
- Final `expo install --check`: dependencies up to date.
- Final `npm ls --all`: **no unresolved/invalid dependency problems**, exit 0.
- Doctor: **20/21 passed**; only the maintained-native/config synchronization
  warning remains. The check was not disabled. Manual native/config comparisons
  and guards address the owned settings; prebuild is not run on production.
- Production Hermes bundles exported for both platforms successfully.
- `pod install`: initially retained the locked RN 0.81 core binary. Updating
  React-Core-prebuilt and ReactNativeDependencies together fixed this; subsequent
  installation completed (**130 pods**, including the local attendance module).
- Xcode 27 / iOS 27 simulator Debug build and launch: **passed**, Welcome screen
  rendered and mobile entry visible. No scene-lifecycle launch assertion observed.
- Normal cold launch and Safari -> app warm return: **passed**, same live PID on
  the background/foreground return. Final RN AppState observations were
  **active -> inactive -> background -> active**. Tests use a logged-out simulator.
- DEBUG-only windowless startup probe: **passed**, one background root followed
  by the explicit scene subclass reusing it; Welcome screen rendered.
- iOS 27 device SDK Release compile: **passed**, unsigned. It is not an archive,
  signed installation, APNs/device test or App Store submission.
- Signed iOS Release configuration build: **passed** using existing local signing
  settings. Deep/strict codesign verification passed; certificate authority and
  configured team match were confirmed. The embedded profile is a **development**
  profile (APS development), so production distribution/APNs/archive validation
  is still pending. Signing settings and source entitlement files were not changed.
- Android arm64 Debug build: **passed**, 577 tasks; module Kotlin and RNFirebase
  compiled. The root project is still ignored/generated.
- Native SQLite 3.50.3 on the iOS 27 simulator: **passed**, parameterized writes,
  exclusive transaction, rollback, close/reopen persistence. The disposable probe
  database was deleted; the attendance database was not modified.
- Native optional geofence bridge availability: **passed**. No fence registered
  and no backend attendance submitted by this probe.
- Native expo-crypto generation: **passed**, 16-byte result with differing bytes;
  random data itself was not logged. Lookup configuration remains lazy.
- Simulator notification permission: **authorized**, after the user selected Allow.
- Foreground remote alert injection: **passed**, the temporary RNFirebase
  `onMessage` listener received the synthetic message ID, including a repeat on
  the final patch set with authorized permission and the default Firebase app.
  The first payload used
  `content-available`; RNFirebase deliberately skips its foreground UN delegate
  event for that flag to avoid duplicate delivery. An alert-only payload exercises
  the foreground path correctly. No production handler or delegate was changed.
- Background alert plus `content-available` injection was accepted by simctl, but
  the app's background-handler timestamp did not change. This does not establish
  real silent APNs/FCM delivery; signed physical-device testing is still required.

## Remaining warnings and practical limits

- Doctor's config/native-folder synchronization warning is expected for this
  maintained iOS project; differences remain explicitly audited, not suppressed.
- Xcode warns about the existing weak capture in ExpoAutoAttendanceModule and
  RNFirebase's always-running configuration script. Optional firebase.json is
  absent as before; defaults were preserved. New framework-switching/dSYM scripts
  were inspected and are the published Expo/RN precompiled build machinery.
- CocoaPods reports the existing pair of entitlement files; Debug and Release
  paths and original file contents were verified. Updates' podspec probes for the
  optional, uninstalled expo-dev-client and prints MODULE_NOT_FOUND to stderr;
  this is caught by the podspec and does not fail pod installation/native builds.
- Android reports dependency deprecations, Gradle 10 incompatibility warnings
  and D8 stack-map warnings from Play Services Auth 21.5.0. Build succeeds; no
  warnings/checks were disabled. Native geofence Kotlin has no new build error.
- npm's last install reported **89 audit findings (1 low, 21 moderate, 65 high,
  2 critical)**. No broad/forced audit fix was applied as part of native migration.
- Jest retains the pre-existing asynchronous open-handle warning after passing.
- Simulator data-only push rejected payloads without visible content (UNError 1401);
  visible push initially rejected missing authorization (UNError 2003). Permission
  is now authorized and the foreground Firebase callback passed. Background silent
  delivery was not observed with simctl; real APNs/FCM remains a device check.
- Real Core Location transitions and cold background APNs cannot be established
  by a forced startup probe. These remain production rollout gates.

## Required device/staging regression matrix

“Unit passed” means contract/behavior tests passed, not OS/backend delivery.
A disposable staging tenant and signed physical builds are needed for the pending
cases. Do not run synthetic attendance against a production employee.

| # | Check | Evidence / remaining work |
| --- | --- | --- |
| 1 | Cold launch | iOS 27 simulator passed; signed device still required |
| 2 | Warm launch | Simulator passed |
| 3 | Background -> foreground | Safari return passed with same PID; device required |
| 4 | Authentication | All auth flow/session/lookup/UI suites passed; live staging QR/password, OTP/password and recovery pending |
| 5 | Session restoration | Session/auth resilience tests passed; persisted device session upgrade pending |
| 6 | Foreground push | Simulator RNFirebase alert callback passed; signed APNs/FCM, tokens and topics pending |
| 7 | Background push | Handler preserved, windowless startup probe passed; simctl silent callback not observed, actual warm/cold FCM delivery pending |
| 8 | Notification tap | Native forwarding preserved; alert/data route and cold/warm tap pending |
| 9 | Camera | Bundles/native builds and screen tests passed; physical capture/QR scan pending |
| 10 | Image picker | API present and bundles compile; gallery/camera permissions and result pending |
| 11 | Location permission | Native compiled; When In Use -> Always and precise/reduced flows pending |
| 12 | Foreground location | Native compiled; real device position pending |
| 13 | Background location | Native wake/persistence retained; signed device background/locked tests pending |
| 14 | Geofence registration | Bridge available; Always+precise registration pending |
| 15 | ENTER | Manager unchanged; JS attendance unit tests pass; actual crossing pending |
| 16 | EXIT | Manager unchanged; checkout unit tests pass; actual crossing pending |
| 17 | Initial ENTER | Retry/synthetic-ENTER logic unchanged; actual registration-inside test pending |
| 18 | Native event replay to JS | Existing replay/session tests passed, background root probe passed; OS cold wake+submission pending |
| 19 | Manual attendance | Existing attendance/session/API tests passed; staging online punch/photo pending |
| 20 | Offline attendance queue | Queue/migration/scope/pairing tests passed; staging airplane-mode/reconnect drain pending |
| 21 | SQLite | Real native rollback/persistence probe passed; existing queued attendance upgrade/drain on device pending |
| 22 | Expo Updates startup | Release compiled and bundle selection retained; signed EAS build startup pending |
| 23 | OTA compatibility | Runtime alignment/isolation guards passed; preview-channel publish/install test pending (nothing published) |
| 24 | Android build | arm64 Debug build passed; physical Firebase/location/geofence regressions pending |
| 25 | iOS Release build | Unsigned compile and development-signed Release build passed; strict signature verified; production archive/device installation pending |

For geofence testing include locked/background, OS-evicted/relaunched process,
initial-inside registration, rapid ENTER/EXIT and offline replay. Verify one React
mount/one attendance transition per event, the original event timestamp and the
current tenant/employee scope. RNFirebase must set its background handler before
its native 25-second wait expires. Validate both notification permission states,
token refresh/topic logic, cold/warm tap routing and Updates selection/reload after
a background wake. A mocked/native build alone is not release approval.

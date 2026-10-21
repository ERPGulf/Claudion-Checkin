# M1 implementation handoff — Automatic Attendance SDK

Prepared 2026-10-09 from the original application's real Kotlin, Swift,
JavaScript bridge, app shell, and offline queue. This is an extraction
specification, not an extraction or an approval to change attendance rules. Read
[08-M0-VALIDATION.md](08-M0-VALIDATION.md) for actual test results and
[09-SDK-DECISIONS.md](09-SDK-DECISIONS.md) for the proposed decision records.

**FACT** identifies behavior verified by reading the current source.
**PROPOSAL** identifies a future SDK contract that is not implemented or
approved. **NATIVE TEST REQUIRED** identifies executable native/device evidence
that mocked Jest tests cannot establish. Source comments about platform delivery
are not device evidence.

## 1. Repository boundary and extraction gate

**FACT.** Original repository: `/Volumes/DevSSD/Projects/claudion-checkin`,
baseline commit `de722c954621bd0eeb980917f397677df9bdc69e` on
`feat/crashlytics`. The source module is `modules/expo-auto-attendance`. Read
the source repository's `AGENTS.md` before working there. The target is the
existing pnpm monorepo `/Volumes/DevSSD/Projects/ui-shared-code`, package
`packages/react-native-auto-attendance`, npm name
`@erpgulf/react-native-auto-attendance`.

**FACT.** The target's `0.1.0-alpha.0` foundation has typed proposals, input
validation, package tooling, and a permission-declaration plugin. Its native
platforms/module lists are intentionally empty. It has no attendance runtime.
This M0 handoff adds no SDK, Kotlin, Swift, production JavaScript, backend
payload, or native integration changes.

**PROPOSAL.** Separate the original extraction plan's work into reviewable
stages:

1. **M1: verbatim native relocation and legacy bridge parity.** Preserve
   existing single-slot behavior and application semantics. Change only
   ownership/package integration, with the minimum necessary build metadata
   adaptation.
2. **M1J: additive native journal, behind a binary opt-in.** Introduce the
   proposed journal and new native APIs while retaining the legacy interface.
   The original app must continue using its existing last-event path unless a
   later migration explicitly enables journal processing.
3. **Later engine/product migration.** Route attendance through journal records,
   new identity rules, new registration keys, presence policy, and a transport
   only after corresponding decisions, regression tests, native builds, and
   devices establish compatibility.

M1 is ready for planning when the M0 characterization evidence is recorded;
production adoption still requires native builds and upgrade/device parity. The
proposed journal decisions are not product approval. A green Jest suite does not
authorize enabling M1J or altering the behaviors it characterizes. Do not treat
the old bounded-journal examples in documents 04/05 as permission to evict
events: the current proposal in 09 uses soft capacity thresholds and no silent
eviction of unacknowledged records.

## 2. Exact native source inventory for M1

Every path below is relative to the original repository root. Preserve the
Kotlin package `expo.modules.autoattendance` and its directory layout. The
public module and Swift subscriber names must continue matching Expo
configuration.

| Original path                                                                                                 | Classes/symbols and extraction responsibility                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/expo-auto-attendance/index.js`                                                                       | `requireOptionalNativeModule("ExpoAutoAttendance")`, legacy exported functions and event constants; port to a typed legacy facade without changing sync/async behavior or missing-binary fallbacks |
| `modules/expo-auto-attendance/package.json`                                                                   | Original private local-module metadata; do not copy its private/name/main fields over the target's publishable foundation                                                                          |
| `modules/expo-auto-attendance/expo-module.config.json`                                                        | Android module FQCN, Apple module class, Apple app-delegate subscriber registration                                                                                                                |
| `modules/expo-auto-attendance/android/build.gradle`                                                           | Expo module Gradle plugin, namespace/group, Play Services dependency                                                                                                                               |
| `modules/expo-auto-attendance/android/src/main/AndroidManifest.xml`                                           | Four permission declarations, transition receiver, boot/update receiver                                                                                                                            |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/ExpoAutoAttendanceModule.kt`  | `GeofenceOptions : Record`, `ExpoAutoAttendanceModule : Module`, exports, permission gates, power receiver, event-bus lifecycle                                                                    |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt`           | `GeofenceManager` singleton, `GeofencingClient`, shared broadcast `PendingIntent`, registration/removal, permission/accuracy/power queries, `restoreFromStore`                                     |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBroadcastReceiver.kt` | `GeofenceBroadcastReceiver`, parsing/errors, ENTER/EXIT handling, last-event write, live event delivery                                                                                            |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBootReceiver.kt`      | `GeofenceBootReceiver`, `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` restoration                                                                                                                     |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt`             | `GeofenceStore`, active config and single last event in SharedPreferences                                                                                                                          |
| `modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceEventBus.kt`          | `GeofenceEventBus`, volatile optional process-local listener                                                                                                                                       |
| `modules/expo-auto-attendance/ios/ExpoAutoAttendanceModule.swift`                                             | `GeofenceOptions: Record`, `ExpoAutoAttendanceModule: Module`, exported methods, main-queue start/stop                                                                                             |
| `modules/expo-auto-attendance/ios/GeofenceManager.swift`                                                      | `GeofenceManager: NSObject, CLLocationManagerDelegate`, singleton location manager, `PendingStart`, `InitialStateOutcome`, `decideInitialState`, callbacks and transition handling                 |
| `modules/expo-auto-attendance/ios/GeofenceStore.swift`                                                        | `GeofenceStore`, UserDefaults monitoring/config/last-event dictionaries                                                                                                                            |
| `modules/expo-auto-attendance/ios/GeofenceEventBus.swift`                                                     | `GeofenceEvents` and `GeofenceEventBus`, optional listener and native wake notification                                                                                                            |
| `modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift`                                  | `AutoAttendanceAppDelegateSubscriber: ExpoAppDelegateSubscriber`, primes the manager at launch when persisted monitoring is true                                                                   |
| `modules/expo-auto-attendance/ios/ExpoAutoAttendance.podspec`                                                 | Pod `ExpoAutoAttendance`, ExpoModulesCore, CoreLocation, iOS/Swift/build settings; fix public source/license metadata without changing runtime                                                     |

**FACT.** Android uses `com.google.android.gms:play-services-location:21.3.0`.
The pod declares iOS `16.4`, Swift `5.9`, static framework,
`DEFINES_MODULE=YES`, `SWIFT_COMPILATION_MODE=wholemodule`, and
`**/*.{h,m,swift}`. Android application minSdk/targetSdk and permissions come
partly from Expo/host build configuration; do not assume the small module Gradle
file establishes the entire support matrix.

**PROPOSAL.** Reuse the target's existing tsup, TypeScript, Vitest, ESLint, pnpm
workspace, and Changesets tooling. Adding Expo native code does not require
replacing the monorepo's build system or modifying `@erpgulf/auth-sdk`. Native
peers must become required when a native runtime is actually shipped. Do not
bundle React/React Native or core backend services.

## 3. Source app integration and files outside the native package

These are **FACT** source dependencies and later extraction candidates, not
files to move during M0/M1:

| Original path                                                                      | Role and boundary                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/AutoAttendanceBootstrap.jsx`                                           | Redux policy/opt-in gate, listeners before registration, serialized ensure-monitoring → replay → presence; calls the session authority and queue service |
| `hooks/useAutoAttendance.js`                                                       | Screen permission prompts via `expo-location`, opt-in controls, dev operations, last-event clearing                                                      |
| `utils/autoAttendance.js`                                                          | Screen helpers and monitoring queries; imports the local module                                                                                          |
| `utils/geofenceEventLog.js`                                                        | Timestamp replay evaluation and global high-water mark                                                                                                   |
| `utils/attendanceSessionState.js`                                                  | Single process-wide transition lock, session record, employee owner, commit only on allowed submission                                                   |
| `utils/attendanceSession.js`                                                       | Legacy session timestamps and timestamp conversion                                                                                                       |
| `utils/attendanceLocations.js`                                                     | Office/location resolution helpers                                                                                                                       |
| `utils/serverClock.js`                                                             | Clock-offset helpers used for server-time semantics                                                                                                      |
| `services/offline/AttendanceDatabase.js`                                           | Existing JS-owned attendance outbox database and schema migrations                                                                                       |
| `services/offline/AttendanceQueueRepository.js`                                    | Queue uniqueness, pairing, atomic claims, FIFO blockers, retry schedules                                                                                 |
| `services/offline/AttendanceQueueService.js`                                       | Online-first automatic submission, cached-policy gate, queue insertion and queued acceptance                                                             |
| `services/offline/attendanceQueueProvenance.js`                                    | Tenant normalization, authenticated employee scope, auth-generation checks                                                                               |
| `services/offline/AttendanceSyncService.js`                                        | Authenticated scoped drain and result handling                                                                                                           |
| `services/offline/BackgroundSyncManager.js`, `services/offline/NetworkListener.js` | JS-only synchronization triggers                                                                                                                         |
| `services/api/attendance.service.js`                                               | Frappe attendance/office/session/server-time calls, online automatic `auto: true`                                                                        |
| `services/offline/AttendanceApi.js`                                                | `buildCheckinRecord`, `pushCheckin`, existing bulk attendance payload and endpoint contract                                                              |
| `redux/Slices/AutoAttendanceSlice.js`                                              | Server policy, user opt-in, `REVERT_ALL` reset                                                                                                           |

**PROPOSAL.** In the later M1 app integration, replace imports from
`../modules/expo-auto-attendance` in the bootstrap, hook, and utility with the
SDK legacy facade. Update mocks and path-reading tests, including
`__tests__/AutoAttendanceBootstrap.checkout.test.jsx`,
`__tests__/AutoAttendanceBootstrap.presence.test.jsx`,
`__tests__/autoAttendanceUi.test.jsx`, and
`__tests__/nativeConfiguration.test.js`. Remove the local native module in the
same integration change that enables package autolinking: never autolink both
implementations of `ExpoAutoAttendance`. The repositories are separate; use a
reviewed workspace example or local file dependency for integration, and do not
copy application services into the SDK.

### iOS application shell remains distinct

**FACT.** `native/ios/AttendanceBackgroundRuntime.swift` defines
`AttendanceBackgroundRuntime` and `AttendanceSceneDelegate`, with Objective-C
scene identifier `ClaudionAttendanceSceneDelegate`.
`plugins/withAttendanceBackgroundRuntime.js` copies that file into the host
Xcode source group, configures its scene manifest, and inserts
`AttendanceBackgroundRuntime.shared.configure(factory: factory, launchOptions: launchOptions)`
into the reviewed Swift AppDelegate. The committed app uses
`ios/ClaudionCheckin/AppDelegate.swift` and a generated/copied
`ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift`.

The native event bus posts `ClaudionGeofenceTransition`. The app-shell runtime
observes it and `RNFBMessagingDidReceiveRemoteNotification`, starts the same
Updates-selected React root only for a background launch with no connected
scene/window, and attempts a 25-second background-task cap. A later scene reuses
that root. The DEBUG environment probe `CLAUDION_TEST_BACKGROUND_STARTUP=1`
exercises startup plumbing; it does not validate real Core Location wake
delivery or server submission.

**PROPOSAL, ownership unresolved.** Leave this Expo SDK 57/RNFirebase/app-shell
integration in the original application for M1. A later optional host
adapter/plugin may own it after explicit ownership review and native/device
tests. Do not place AppDelegate scene factories or FCM coupling in the
geofencing core. Do not claim an arbitrary React Native host gets background
JavaScript from the module alone.

## 4. Legacy Expo exports: exact TypeScript-to-native mapping

**FACT.** Both modules register `Name("ExpoAutoAttendance")`, and declare
`onGeofenceEnter`, `onGeofenceExit`, `onError`. The original JS bridge uses
`requireOptionalNativeModule` imported from `expo`. Calling required methods
without a native module throws exactly
`expo-auto-attendance is only available in native builds that include the module`.

| Legacy JavaScript export                                     | Android native                                                       | iOS native                                                            | Return/lifecycle contract to preserve                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isAvailable()`                                              | No native call                                                       | No native call                                                        | Synchronous boolean from module presence                                                                                                               |
| `startGeofence({ latitude, longitude, radius, identifier })` | `AsyncFunction("startGeofence")` → `GeofenceManager.startMonitoring` | `AsyncFunction("startGeofence")` on `.main` → `GeofenceManager.start` | Promise resolving void/null after OS registration callback; requires permissions already granted                                                       |
| `stopGeofence()`                                             | `AsyncFunction("stopGeofence")` → remove via shared PendingIntent    | `AsyncFunction("stopGeofence")` on `.main` → manager stop             | Promise; Android can reject removal, iOS resolves after stop requests and stored-state clearing                                                        |
| `isMonitoring()`                                             | `Function` → stored flag                                             | `Function` → stored flag                                              | Synchronous boolean; does not prove OS registration                                                                                                    |
| `hasFullAccuracy()`                                          | `Function` → FINE permission check                                   | `Function` → full accuracy authorization                              | Synchronous boolean; JS fallback true if module/function absent. Android implementation is not an unconditional true despite the older wrapper comment |
| `isLowPowerModeEnabled()`                                    | `Function` → Android PowerManager saver                              | `Function` → ProcessInfo low-power flag                               | Synchronous boolean; JS fallback false if missing                                                                                                      |
| `isIgnoringBatteryOptimizations()`                           | `Function` → PowerManager exemption                                  | No iOS export                                                         | Synchronous boolean; JS fallback true on missing export/module                                                                                         |
| `getRegisteredGeofences()`                                   | `Function` → saved config when stored flag true                      | `Function` → saved config when stored flag true                       | Synchronous array of `{ identifier, latitude, longitude, radius }`; not an actual OS enumeration                                                       |
| `getLastEvent()`                                             | `Function` → parsed `last_event` fields                              | `Function` → UserDefaults event dictionary                            | Synchronous event/null                                                                                                                                 |
| `clearLastEvent()`                                           | `Function` → remove last-event key                                   | `Function` → remove last-event key                                    | Synchronous void; separate from stopping monitoring                                                                                                    |
| `addGeofenceEnterListener(cb)`                               | Expo `addListener("onGeofenceEnter", cb)`                            | Same                                                                  | Subscription with `.remove()`; live delivery only                                                                                                      |
| `addGeofenceExitListener(cb)`                                | Expo `addListener("onGeofenceExit", cb)`                             | Same                                                                  | Subscription with `.remove()`; live delivery only                                                                                                      |
| `addErrorListener(cb)`                                       | Expo `addListener("onError", cb)`                                    | Same                                                                  | Subscription with `.remove()`                                                                                                                          |

**FACT.** Native `GeofenceOptions` defaults are latitude `0`, longitude `0`,
radius `100` meters, identifier `office`. Production JS instead supplies
`OFFICE_GEOFENCE_IDENTIFIER = "office-main"`. Preserve that distinction;
changing the native default to the production constant is not a verbatim move.

Existing `startGeofence` error codes are `ERR_INVALID_OPTIONS`,
`ERR_LOCATION_PERMISSION`, `ERR_BACKGROUND_LOCATION_PERMISSION`,
`ERR_GEOFENCE_REGISTRATION`, and iOS `ERR_REDUCED_ACCURACY`. Android stop uses
`ERR_GEOFENCE_REMOVAL`. Preserve source rejection messages in the legacy facade.
iOS reduced-accuracy copy contains the original application name; generalizing
that copy is a deliberate later change. Raw `onError` payloads use numeric codes
and messages: iOS authorization `-1`, power `-2`, precise off `-3`; Android
power `-2` and Play Services numeric errors. SDK-normalized errors are additive,
not replacements for compatibility channels.

## 5. Compatibility identifiers and registration behavior

| Identifier / behavior                      | Source-derived fact                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Kotlin package and Android namespace/group | `expo.modules.autoattendance`                                                                               |
| Android module FQCN                        | `expo.modules.autoattendance.ExpoAutoAttendanceModule`                                                      |
| Android receiver components                | `expo.modules.autoattendance.GeofenceBroadcastReceiver`, `expo.modules.autoattendance.GeofenceBootReceiver` |
| Shared Android PendingIntent request code  | `4821`; explicit broadcast component; `FLAG_UPDATE_CURRENT`, plus `FLAG_MUTABLE` on Android S+              |
| Expo native module / iOS pod               | `ExpoAutoAttendance`                                                                                        |
| Apple subscriber                           | `AutoAttendanceAppDelegateSubscriber`                                                                       |
| Production region identifier               | `office-main`                                                                                               |
| Events                                     | `onGeofenceEnter`, `onGeofenceExit`, `onError`                                                              |
| iOS wake notification                      | `ClaudionGeofenceTransition`                                                                                |
| Scene bridge identifier                    | `ClaudionAttendanceSceneDelegate`, owned by the app shell                                                   |

**FACT.** Android registers a circular fence with `NEVER_EXPIRE`, ENTER/EXIT,
and `INITIAL_TRIGGER_ENTER`. Success saves config and monitoring=true. Failure
does not establish registration truth. Stop removes every fence associated with
the shared PendingIntent; success clears config/flag, failure leaves stored
state. Boot/update receiver restoration checks stored monitoring,
fine/background permissions and config, then re-adds the saved fence. It is not
a native server-submission worker.

**FACT.** iOS requires any location authorization, then Always, then full
accuracy. It checks circular-region availability, rejects concurrent
`PendingStart`, clamps radius to `maximumRegionMonitoringDistance`, stops
previously stored/same identifiers, and starts the new region.
`didStartMonitoringFor` saves the clamped config, requests initial region state,
and resolves registration. `.inside` produces synthetic ENTER; `.outside`
settles; `.unknown` retries after 2, 4, 8 seconds and then settles. Stop clears
initial-state requests and saved config/flag but leaves last-event storage. The
source has no start timeout. `stop` does not explicitly clear `pendingStart`;
late registration callbacks after stop are a native race to characterize, not an
approved fix during relocation.

**PROPOSAL.** Preserve all of these compatibility-sensitive names and decisions
for M1. New v2 native registration identifiers are a separate approved binary
migration; do not rename `office-main` or either Android receiver while doing a
package move.

## 6. Existing persisted formats and ownership

### Native storage: exact legacy schema

**FACT.** Android uses application-private SharedPreferences named
`expo_auto_attendance`. JSON objects below are stored as JSON strings; all
source writes use `SharedPreferences.Editor.apply()`.

| Android key  | Persisted value                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monitoring` | Boolean, default false                                                                                                                              |
| `geofence`   | JSON string `{ "identifier": string, "latitude": number, "longitude": number, "radius": number }`; radius is stored as Double from the native Float |
| `last_event` | JSON string `{ "transition": "ENTER"\|"EXIT", "identifier": string, "timestamp": integerEpochMs }`                                                  |

`clearGeofence` removes `geofence`, sets `monitoring=false`, and does not remove
`last_event`. Invalid saved JSON reads as null. `clearLastEvent` removes only
its key.

**FACT.** iOS uses `UserDefaults.standard`, not a custom suite.
`expoAutoAttendance.monitoring` is a Boolean; `expoAutoAttendance.geofence` is a
property-list dictionary with `identifier`, `latitude`, `longitude`, `radius`;
`expoAutoAttendance.lastEvent` is a property-list dictionary with `transition`,
`identifier`, `timestamp` (`Int64` epoch milliseconds). Config/flag clearing
leaves the event dictionary intact.

Neither native format has employee, tenant, auth generation, policy, stable
event ID, acknowledgment, sequence, or prior-event history. Native timestamp is
wall-clock **receipt time**, not a measured physical crossing time. Preserve it
through relocation; do not claim old data contains fields it never stored.

### JavaScript replay/session and offline storage remain host-owned

**FACT.** `autoAttendanceLastProcessedEventAt` is a single AsyncStorage
timestamp string shared across scopes. Replay accepts only ENTER/EXIT newer than
that mark, within 24 hours, and no more than 60 seconds in the future.
`markEventProcessed` never moves it backward. `attendanceSessionState` stores
`{ status, origin, startedAt, endedAt, closedBy }`; `attendanceSessionOwner` is
an employee-code string. Legacy keys include `checkinStartTime`,
`lastCheckoutTime`, `serverClockOffset`, `attendanceConfigCache`,
`offlineSyncSupported`, policy/location mirrors, and Redux's persisted `root`.
The native module owns none of them.

**FACT.** `services/offline/AttendanceDatabase.js` opens
`claudion-attendance.db`, table `attendance_queue`, schema version 4. Base
columns include `id`, `employeeId`, `employeeDocname`, nullable `tenantKey`,
`attendanceType`, `action`, server-wall-clock text `timestamp`, device
coordinates/accuracy/address, `deviceId`, JSON-text `payload`,
status/retry/delivery/error/audit fields. v2 adds `failureClass`,
`blockedSince`, `resolutionDocname`, `resolvedAt`, `sessionId`,
`pairedAttendanceId`; v3 introduces tenant provenance; v4 adds
`acceptanceConfirmed`, verification evidence/times/issue, `lastAttemptAt`,
`attemptCount`. Retain all migrations and historical manual/photo rows.

The unique index is on `(IFNULL(tenantKey, ''), employeeId, timestamp, action)`.
Queue states are `pending`, `syncing`, `synced`, `blocked`, `rejected`,
`resolved`, `needs_review`. Claims are tenant/employee scoped, but an older
NULL-tenant row for the same employee can block an attributable younger row. Old
rows deliberately retain NULL rather than inventing ownership.

Online `autoCheckInOut` sends `auto: true` through
`employee_app.attendance_api.add_log_based_on_employee_field`. Offline automatic
rows retain `attendanceType: "auto"` locally; their queue payload and
bulk-upload record do not carry that online `auto` flag.
`services/offline/AttendanceApi.js` implements `buildCheckinRecord` and
`pushCheckin` through
`employee_app.attendance_api.add_offline_employee_checkins`, sending
`{ logs: [record] }` one record per request. The record fields are `employee`,
`timestamp`, `device_id`, `log_type`, `over_time`, and optional `location`.
Backend acceptance of a new `auto` or idempotency field remains unverified. M1
must not add fields or change endpoints.

**PROPOSAL.** Keep the future native transition journal in a separate
native-owned database. It is evidence of OS delivery, not a replacement for the
JS attendance outbox or session machine. Do not point it at
`claudion-attendance.db`, rewrite schema-v4 rows, or stamp today's tenant onto
historical NULL records.

## 7. Scenario H: native single-slot characterization and limits

### Real Android path

**FACT.** `GeofenceBroadcastReceiver.onReceive` parses `GeofencingEvent`. Errors
emit `onError` and return without recording a transition. Unsupported
transitions return. For ENTER/EXIT it reads triggering request IDs, takes the
first as `identifier` (or an empty string), timestamps
`System.currentTimeMillis()`, calls `GeofenceStore.saveLastEvent`, and only then
`GeofenceEventBus.emit`. The live payload keeps all triggering IDs; persisted
data keeps only the first. With no listener, the volatile bus drops live
delivery. The API-call/WorkManager comments are empty hooks.

### Real iOS path

**FACT.** `didEnterRegion`, `didExitRegion`, and initial-state `.inside` call
`handleTransition`. It timestamps `Date().timeIntervalSince1970 * 1000`, calls
`GeofenceStore.saveLastEvent`, and then `GeofenceEventBus.shared.emit`. For
transitions the bus first posts `ClaudionGeofenceTransition`, then invokes its
optional listener. Background app-shell JavaScript may start from that
notification, but the native module itself does not submit attendance.

### Observable overwrite semantics

**FACT.** If ENTER(A), EXIT(A), ENTER(A) are processed while no JS listener is
attached, each write replaces the same native key. `getLastEvent` can return
only the last ENTER's `{ transition, identifier, timestamp }`. There is no
native history API, no per-event acknowledgment, and no queue in either event
bus. This conclusion follows from the real setters and callbacks, not a passing
JavaScript mock of an invented journal.

**NATIVE TEST REQUIRED.** Source code proves write invocation precedes emit; it
does not prove durable disk completion before immediate process death. Android
`apply()` and iOS UserDefaults persistence do not give this source a verified
transactional journal. Native thread/process timing, background delivery,
force-stop/force-quit, disk errors and reboot survival are untested here. Do not
report H as a passed native test or use mocked Jest events as device evidence.

### Executable specification for the existing implementation

| Case      | Real native harness / stimulus                                                                                                                                   | Current-behavior expectation; evidence still required                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-A1      | Kotlin/Robolectric test using real `GeofenceStore`, cleared app-private test preferences; detach bus; call real `saveLastEvent` with ENTER at t1 then EXIT at t2 | Only EXIT/t2 exists under `last_event`; no second entry/history. This covers the store, not Play Services OS delivery                                                                                                        |
| H-A2      | Receiver integration test with real Play Services-format geofencing intents and a listener spy                                                                   | Each accepted transition calls save before live callback; multi-ID callback's saved identifier is the first, while live payload contains all IDs. Do not fake `GeofencingEvent` success if the fixture cannot be constructed |
| H-I1      | XCTest in an isolated app/test process using the real default-store keys; write ENTER/t1 then EXIT/t2, read real `getLastEvent`; restore/clean test keys         | Only EXIT/t2 remains; config clearing preserves it. Current private singleton/test-store coupling may need a native test target before this is runnable                                                                      |
| H-I2      | XCTest/delegate harness calling real didEnter/didExit and inspecting store at bus/notification delivery                                                          | Last-event write is visible before notification/listener; initial `.inside` also writes ENTER; unknown retries emit no fabricated transition                                                                                 |
| H-PERSIST | Android/iOS device build: deliver successive transitions with no JS runtime, terminate/restart at controlled points, read real persisted keys                    | Determine what survives, and separately assess immediate-kill write durability. Do not equate orderly preference reopening with abrupt-kill durability                                                                       |
| H-UPGRADE | Existing opted-in app → M1 binary upgrade → real region transitions                                                                                              | Receivers/subscriber/identifiers still work and prior single-slot data remains readable; requires physical-device evidence                                                                                                   |

No native harness or device test has been created/run in M0. The source module
contains no Kotlin/JVM/Robolectric or XCTest test target. The specifications
above intentionally remain **not executed**, with no invented passing counts.

## 8. Proposed v2 capture record and native journal

**PROPOSAL.** Use native SQLite transactions (`android.database.sqlite` on
Android; native SQLite3 on Apple), accessible from callbacks without
Expo/React/JavaScript. Do not rely on `expo-sqlite` JavaScript availability for
capture. A serial writer owns configuration, immutable registration mappings,
sequence allocation, journal insertion, and acknowledgment. Select and verify
WAL/synchronous/file-protection settings with crash tests before claiming
durability. A transaction's successful durable commit must precede the new v2
live event.

Example contract below contains no real identity or credentials. Exact SQL DDL,
naming, data protection, backup exclusion, and native binding choices still need
implementation review:

```ts
type CaptureRecordV2 = {
  schemaVersion: 2;
  eventId: string; // native random UUID, persisted once
  sequence: string; // installation-global receipt order as decimal text
  captureGroupId: string | null; // optional shared UUID for one multi-region callback
  platform: "android" | "ios";
  regionId: string; // host-facing region ID
  regionSnapshot: {
    id: string;
    latitude: number;
    longitude: number;
    radiusM: number;
  } | null;
  nativeRegistrationKey: string; // exact callback identifier
  registrationGeneration: string | null;
  transition: "ENTER" | "EXIT";
  source: "os" | "initial-state" | "restore" | "legacy-import";
  occurredAt: number; // receipt wall-clock epoch milliseconds
  elapsedRealtimeMs: number | null; // capture monotonic milliseconds
  bootId: string | null; // verified same-boot discriminator
  scope: { tenantId: string; subjectId: string; scopeVersion?: number } | null;
  policyAtCapture: "off" | "detect" | "record" | null;
  appState: "active" | "background" | "unknown";
  sdkVersion: string;
  attribution: "verified-registration" | "legacy-unattributed" | "quarantined";
  quarantineReason: string | null;
};
```

`occurredAt` preserves source receipt-time meaning; the SDK cannot infer an
exact crossing time. Native SQLite sequence is exposed as decimal text so
JavaScript cannot lose 64-bit ordering precision. `regionSnapshot` is the
immutable registered region configuration, not a device-location fix.
`policyAtCapture` records policy evidenced by the selected registration context;
legacy policy remains null, and using this field to govern attendance rather
than the source's processing-time policy requires approval. Monotonic age is
usable only when the boot discriminator proves the same boot; after
restart/reboot ambiguity, retain wall-clock evidence and expose uncertainty. Do
not relabel a random per-process ID as a boot ID. Select a real platform
mechanism or leave the field null. Avoid inferred `not-running` application
state that native lifecycle signals cannot prove. Optional device coordinates
and retention are separate product/privacy decisions, not defaults to invent
here.

The foundation's existing `TransitionRecord` is a type-only proposal. Nullable
legacy policy, explicit generation/sequence/attribution, and `legacy-import`
differ from that shape. Finalize a versioned record/union during M1J; do not
coerce unknown provenance to a current employee or unknown policy to `record`
merely to satisfy its present TypeScript type.

### Persistence model and ordering

**PROPOSAL.** Persist installation metadata and schema version, immutable
`registration_snapshots`/mapping tombstones, current desired
configuration/reconciliation evidence, a transition row with unique UUID and
increasing sequence, separate acknowledgment state/time, and migration markers.
Sequence comes from one native DB writer/transaction for the installation, not
wall-clock sorting or a per-employee in-memory counter. The primary ordering is
oldest native receipt sequence; wall-clock jumps must not discard or reorder
already captured evidence. Every captured record retains its original
scope/generation.

New random IDs identify individual native receipts; they deduplicate repeated
delivery/replay of that same stored record. They do **not** prove two
independently repeated OS callbacks were one physical crossing. Keep both
receipts; later session/transport policies determine attendance consequences.
For a v2 Android callback covering several verified registration keys, propose
one row per region with an optional common capture-group ID; preserve the
original first-identifier legacy payload behavior in compatibility mode.
Exactly-once remote submission cannot be promised without a validated server
idempotency contract.

### Capacity and persistence failures

**PROPOSAL.** Keep every unacknowledged event; thresholds are diagnostic
warnings, not an eviction policy. Do not trim the oldest unresolved transition
or replace the journal with a last-event slot when capacity is exceeded.
Acknowledged retention/purge requires an explicit policy. Indefinite unresolved
retention and finite device storage remain a product/operations risk, not an
unlimited-capacity guarantee.

Disk-full, corruption, locked/protected database, failed migration, timeout and
commit failure must report degraded/storage-error state. Never emit a v2 event
as durably captured when its commit failed. M1J must define and test the
boundary with the old compatibility path: preserving legacy attendance delivery
on journal failure and failing closed for v2 are distinct contracts. Do not
silently suppress legacy production events to achieve a new durability claim.
Crash recovery and receiver/delegate time budgets require native tests; a record
never successfully written cannot be guaranteed recoverable.

## 9. Proposed scope and registration-generation lifecycle

**PROPOSAL.** The host supplies tenant/employee identity as opaque identifiers;
authentication credentials stay in the host. Capture provenance comes from an
immutable registration snapshot, not from whatever account JavaScript happens to
expose when replaying a callback.

1. Validate requested scope/regions/policy and create a fresh registration
   generation.
2. In a native DB transaction persist that generation's immutable
   scope/policy/region snapshot and desired configuration.
3. Use a unique v2 native key such as `aa/v2/<generation>/<regionId>` with an
   explicit mapping back to the host region. The encoding, length constraints,
   and namespace are proposed and need native/platform validation.
4. Register/remove only SDK-owned OS regions, and record success/failure
   evidence against the generation. OS registration is asynchronous external
   state; it cannot be made atomic merely by an SQLite transaction.
5. On each callback, resolve its exact native key to the immutable generation
   snapshot. A delayed old callback keeps the old owner; it never inherits the
   new active employee.
6. If the key/mapping is unavailable, stale in an unprovable way, or ambiguous,
   append a null-scope quarantined record with a reason. Do not guess ownership
   or send it under the current session.
7. Keep mappings/tombstones for in-flight and historical callbacks under an
   explicit retention policy. A changed current-scope pointer never rewrites a
   captured record.

**Compatibility risk requiring approval.** The existing `office-main` key is
reused across employees/tenants and contains no registration generation. Current
active scope, last-write timestamps, and mutable PendingIntent extras under
`FLAG_UPDATE_CURRENT` cannot prove which earlier registration generated a
delayed callback. Keep `office-main` and request code `4821` unchanged for
compatibility M1. Treat unresolved legacy-key callbacks as unattributed. Enable
generation-specific keys only through a reviewed opt-in binary migration; then
test upgrades, OS cleanup, delayed callbacks, reboot, and rollback.

**PROPOSAL.** Employee/tenant switching uses a serialized native state machine:
pause processing/start admission, persist new desired generation/configuration
transactionally, reconcile old removal/new registration, and report partial
failure. Keep all old journal rows. Public acknowledgments must verify permitted
event ownership/version, or use an explicitly restricted host migration path for
legacy handling. An OS removal failure must not result in current-account
attribution of the old callbacks. Atomic DB updates are achievable; atomic
DB-plus-OS switching is not promised.

**PROPOSAL.** Immutable capture `registrationGeneration` and `scopeVersion` are
provenance, while the host's current auth/lifecycle generation is a separate
processing cancellation guard. Relogin to the same tenant/subject can handle its
retained events from older registrations using fresh credentials and a fresh
guard. Do not compare capture generation to login generation as an eligibility
requirement. If an explicit scope-version change should quarantine older
records, define that as a separate approved policy. A switch cancels stale
in-flight host work without rewriting historical ownership.

Product decisions about whether explicit logout/token expiry should stop
capture, retain opt-in, or wait for reauthentication remain unresolved. M1
retains the source app's `REVERT_ALL` reset and stop behavior. Journal evidence
should retain ownership independently of a login token; that does not authorize
unattended submission with expired credentials.

## 10. Legacy last-event migration without invented ownership

**PROPOSAL.** Keep both legacy native stores/keys and their public read/clear
signatures for compatibility. The v2 journal is additive; legacy event
names/payloads remain intact. Do not replace `getLastEvent()` with a journal
pending query or make clear-last-event acknowledge/delete journal rows.

On first v2 migration, read the real native legacy record, validate its fields,
and import at most one `legacy-import` row with a new persisted UUID, preserved
wall timestamp, null scope, null registration generation/policy, and
`legacy-unattributed` or quarantined status. A transaction records a migration
marker/fingerprint with the inserted row so crash/retry does not duplicate the
same import. Define how later legacy slot updates during rollout are
distinguished; do not reimport that initial slot on every launch. No JS scope,
cached employee, or current backend can retroactively establish the legacy row's
identity.

Use an opaque fingerprint for migration identity rather than exposing tenant or
employee values in logs. Read-only diagnostics can surface an unattributed count
and safe reason; release logs omit raw identity/coordinates. Human/host
adjudication of an old row is a separate approved recovery workflow. Never
auto-submit or auto-reassign it.

Dual writes to native SQLite and SharedPreferences/UserDefaults are not one
cross-store transaction. Commit the v2 row before new delivery, and retain the
original legacy write-before-legacy-emit semantics. Specify failure recovery and
mirror precedence explicitly, and test crashes between journal commit, legacy
mirror update, notification, and live emission. Leave the old replay high-water
mark intact until an approved engine migration; it must not be used to infer v2
acknowledgments or discard a differently identified journal row.

## 11. Proposed acknowledgment/replay lifecycle and new API mapping

**PROPOSAL.** Capture → commit native record → optionally emit its committed
event ID → host intake → durable host handling → explicit native acknowledgment.
Listener delivery and reading pending records never acknowledge them. A host
outbox transaction may qualify as durable handling if it retains the same event
ID/scope and assumes delivery responsibility. A console log, temporary promise,
UI state, or an unverified backend response does not.

`getPendingEvents` returns unacknowledged eligible records in native sequence
order. Quarantined/foreign/unattributed evidence must be visible through an
explicit restricted diagnostic/review query without becoming actionable
attendance. Repeated acknowledgment of an existing ID is idempotent and durable.
Unknown IDs must not create success evidence for an event that was never
captured; choose and document an error/report contract. A stopped monitor,
logout, account switch, crash, repeated initialization, or repeated pending read
must not delete unacknowledged rows.

Acknowledgment validates the event's immutable tenant/subject/registration
provenance and the current authorized host context independently. A fresh
same-scope login may acknowledge durable handling of an older registration
record. An acknowledgment created by canceled or foreign-scope host work must be
refused; capture and login generations need not match.

Replay window, processing-time versus capture-time policy, automatic
acknowledgments for ignored/expired events, quarantined recovery, and
presence-generated attendance are product-dependent decisions. Characterization
tests pin current 24-hour/60-second/high-water behavior for compatibility; they
do not establish permission to drop a new journal event. Proposed v2 engine
expiration is an explicit disposition, not silent deletion.

| Future public TypeScript API       | Proposed native boundary                                                          | M1/M0 status                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `initialize(configuration)`        | Validate host inputs and orchestrate a native transactional config/generation API | Type-only foundation proposal; not a legacy native export                          |
| `startMonitoring()`                | Native reconciler, legacy `startGeofence` only in explicit compatibility mode     | Desired/acknowledged status needed; no new implementation                          |
| `stopMonitoring()`                 | Native reconciler/legacy stop; retains journal                                    | Preserve old stop contract in M1                                                   |
| `updateGeofences(regions)`         | New generation/set-regions API and OS reconciliation                              | Does not exist in original module; changes stale-fence behavior and needs approval |
| `getStatus()`                      | New desired/acknowledged/effective native status                                  | Never alias to persisted `isMonitoring()` and claim actual OS truth                |
| `requestPermissions(options)`      | Platform UI permission APIs with host user-gesture disclosure                     | Not an original native export; the app currently uses `expo-location`              |
| `getPendingEvents()`               | New async native journal read                                                     | Native-only durability; running JS needed to invoke it                             |
| `acknowledgeEvent(eventId)`        | New async native transactional `acknowledgeEvents([eventId])`                     | Explicit/idempotent; no legacy clear/high-water alias                              |
| `addListener("geofenceEvent", cb)` | Additive v2 committed-record stream                                               | Preserve separate legacy ENTER/EXIT/error channels                                 |
| `getDiagnostics()`                 | New redacted native status/counts/storage errors                                  | No server/network/identity telemetry by default                                    |

A native v2 `setScope`/configuration transaction, generation-aware registration,
`getPendingEvents`, `acknowledgeEvents`, and status query must be added
explicitly. Calling current `startGeofence` alone cannot create capture-time
tenant attribution. Do not assert the foundation's illustrative signatures are
finalized; reconcile them with 09 and the actual platform implementation before
adding public runtime exports. All TypeScript invocation/listener/host transport
operations need a running JS runtime; native persistence/capture does not.

## 12. Registration truth, permissions, and platform differences

**FACT.** Both legacy monitoring queries trust stored state. iOS can inspect
`CLLocationManager.monitoredRegions`, but the current exported query does not.
Android's current code has no equivalent enumeration of all Play Services fences
and no `GEOFENCE_NOT_AVAILABLE` recovery/reconciliation loop. Boot restoration
re-adds desired saved configuration, not a verified uninterrupted monitoring
guarantee.

**PROPOSAL.** Expose desired configuration separately from last registration
acknowledgment, its generation/time/boot evidence, and effective degraded
reasons. On Android do not label a preference or stale add-success receipt as
proof a fence exists now. On Apple match only SDK-owned current-generation
monitored regions. Permission/accuracy/provider/power changes invalidate or
degrade evidence. Re-registration thresholds, office changes, all-offices versus
nearest-only, and synthetic ENTER effects require product compatibility
decisions before enabling them.

| Capability                          | Source fact                                                                                  | Required future validation                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Native background capture           | Android receiver; Apple delegate/subscriber                                                  | Real process death, reboot/upgrade, callback and storage timing                                  |
| Native HTTP submission              | None on either platform                                                                      | Optional host transport; no native backend coupling                                              |
| Background JS                       | Android source has no worker/headless startup; Apple app shell attempts a windowless runtime | iOS budget/root/Updates/device checks; Android WorkManager/HeadlessJS remains a later experiment |
| Permissions                         | Android FINE + background on API29+; Apple Always + full accuracy                            | Denial/downgrade/regrant and host disclosure behavior                                            |
| Initial ENTER                       | Android `INITIAL_TRIGGER_ENTER`; Apple initial requestState/retries                          | Boundary/unknown timing and duplicate domain handling                                            |
| OS limits                           | Platform guidance in 03: Android 100 / Apple 20                                              | Shared host region allocation and applicable current platforms; not tested device capacity here  |
| Force-stop/force-quit and OEM power | Source contains warnings/copy; no proof of universal delivery                                | Physical devices, OS/OEM matrix; do not market guaranteed killed-app submission                  |

## 13. Platform implementation sequence after authorization

### Android M1 then M1J

1. Copy the six Kotlin source files and manifest/build configuration verbatim
   into the target package; preserve FQCNs, module name, PendingIntent
   component/request code/flags, preference keys and raw errors.
2. Activate real Expo module metadata only when the Kotlin sources and native
   project are present. Verify one module registration, merged manifest,
   permissions, Play Services, min/target SDK, release compilation, and package
   archive.
3. Integrate the legacy facade in a disposable host and original app parity
   change; run M0/source suites and a binary upgrade from active monitoring.
4. In a later opt-in M1J change, add native SQLite journal/config/generation
   mapping, boot-safe clock metadata, scoped reads/acknowledgments, and degraded
   error status. Keep the legacy store/API alongside it.
5. Test receiver time budgets and async completion if journal work requires
   `goAsync`; do not assume a JS task or process will stay alive. Test
   commit-before-v2-emit, abrupt kill, disk failures, corruption, and boot
   restoration before claiming durability.
6. Add generation-specific OS registration identifiers only after compatibility
   review. WorkManager/HeadlessJS/native transports do not belong in M1.

### Apple M1 then M1J

1. Copy the five Swift source files and podspec; preserve module/subscriber
   class names, UserDefaults keys, event/wake names, main-queue registration,
   initial-state retry behavior and radius clamp.
2. Activate Apple module/subscriber metadata; verify CocoaPods/native provider
   discovery and release compilation, including the unchanged host app-shell
   scene/runtime integration.
3. Test an active region through binary upgrade and cold launch; maintain
   committed iOS project/plist/settings explicitly.
4. In opt-in M1J, add SQLite3 journal/config/generation mapping on a serialized
   native writer with verified application-private file protection. Write/commit
   before new notification/listener delivery; keep the legacy mirror.
5. Add native tests for initial-state decisions, main-runloop manager lifecycle,
   registration failure/timeout design, scope switching/delayed callbacks, and
   crash/storage conditions. Changing pending-start cancellation/timeout
   behavior needs its own reviewed regression.
6. Keep background JS runtime ownership separate until approved; verify
   windowless root reuse, Updates reload behavior, expiration, scene connection,
   and no interactive cold-boot authentication during wakes on devices.

Native changes require a new binary and aligned runtime-version changes in
`app.json` and `ios/ClaudionCheckin/Supporting/Expo.plist`; OTA cannot add
Kotlin/Swift or SQLite bindings. Follow the source repository's guardrails for
committed iOS files. Never run unscoped clean prebuild over that work. Old
binaries must continue tolerating absent new native exports through
optional-module/function checks.

## 14. Native and integration acceptance test plan

These are **PROPOSAL / NATIVE TEST REQUIRED**, not M0 passing tests. Keep
current-behavior characterization tests separate from desired-behavior
regressions; flip a characterization expectation only in the approved change
that deliberately replaces it.

| Area                  | Required assertion / harness                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy wrapper        | Real typed legacy facade against optional native module mocks: missing-binary import safe, exact throw/fallbacks, sync queries and Promise start/stop, event names, subscription removal                                   |
| Android native parity | Receiver/store/bus/boot tests; real Gradle release build; PendingIntent request code/flags/component; missing/revoked fine/background permission; add/remove failure and persisted-state semantics                         |
| Apple native parity   | XCTest `decideInitialState` inside/outside/unknown retry exhaustion; main-runloop delegate; radius clamp, concurrent start, late callbacks after stop, priming/subscriber/wake order; CocoaPods/release build              |
| Journal durability    | Real native SQLite transaction tests, commit-before-new-emit, ENTER→EXIT→ENTER with JS absent, crash before/after commit, reopening after immediate kill, disk-full/protected/corrupt DB and interrupted migration         |
| Journal identity      | UUID stable across pending reads, reboot and replay; receipt sequence monotonic under concurrent writes and backwards wall clock; same-millisecond events preserved; OS duplicate receipts are not falsely collapsed       |
| Acknowledgment        | Reading/live delivery never ACK; durable host handoff then transactional ACK; repeated ACK idempotent; crash before ACK replays the same ID; crash after ACK does not replay it; unknown/foreign ID behavior explicit      |
| Scope isolation       | A→B employee switch, same employee across tenants, callback from old generation after switch, mapping unavailable, stale boot restore, logout/expiry; original record ownership retained and ambiguous records quarantined |
| Capacity/retention    | Exceed soft threshold without dropping unacknowledged rows; explicit approved acknowledged cleanup; full disk surfaced as degradation; no synthetic durable-capture success                                                |
| Legacy migration      | Real SharedPreferences JSON/UserDefaults import; malformed legacy data; one-time marker; crash between import and marker transaction; no current-scope attribution; rollback preserves legacy last event                   |
| Compatibility         | M0 tests remain green for verbatim M1, exact legacy event payloads/keys/endpoint shapes, single session authority, no queue schema or retry changes, no duplicate autolinked module                                        |
| Host packaging        | ESM/type/CommonJS plugin consumers, Expo dev build, autolinking and one native provider, Android/iOS release checks, pnpm workspace, npm archive allowlist, absence of credentials/unnecessary app source                  |
| Physical devices      | Android boot/upgrade/killed process/location revocation/OEM power/force-stop; Apple region wake/reboot/force-quit ambiguity/low power/background refresh/Updates/root reuse; documented actual outcomes and devices        |

A journal does not replace the source session lock. ENTER→ENTER / EXIT→EXIT
suppression currently comes from session authority, with timestamp replay mark
and outbox uniqueness as separate layers. Future live/replay concurrency must
share one engine intake and one session authority; two app/SDK locks can
reintroduce duplicate submissions. Network uncertainty requires transport
verification/server idempotency, not an invented native exactly-once guarantee.

## 15. Risks and decisions still requiring approval or external evidence

**PROPOSAL, not approved.** Decide and record before changing: capture-time
versus processing-time policy; manual checkout followed by presence; presence
registration-only versus every start; nearest versus multiple offices; office
update reconciliation and initial triggers; opt-in after token expiry versus
explicit logout; feature flags that hide UI versus stop capture; location
capture/privacy; unresolved and acknowledged retention; overflow/storage-failure
operational response; legacy recovery authorization; generation-key migration
and rollback; background-runtime ownership; Android killed-process submission
requirements; Frappe offline `auto` and idempotency contracts.

Source M0 characterizations deliberately reproduce current defects. They
establish a reference, not desired product requirements. No real tenant,
employee, access token, refresh token, endpoint credential, or user fixture is
included in this handoff. The next agent must carry forward
production/Crashlytics work, review source and SDK diffs separately, and report
native/device checks that remain unexecuted.

## 16. Handoff checklist for the next coding agent

- Read 08 actual validation results, 09 proposed decisions, this handoff, and
  source/target repository instructions. Recheck source HEAD/working tree and
  preserve pre-existing work.
- Confirm M0 tests and existing relevant suites pass with precise counts; do not
  convert a desired regression into a green characterization by weakening it.
- Implement only the authorized stage. A verbatim M1 move does not implicitly
  authorize M1J, an engine, a Frappe adapter, or a product policy change.
- Preserve every legacy identifier, event, sync/async signature, storage key,
  session authority, outbox migration and attendance payload listed above.
- Remove the local module only as part of the reviewed source-app integration;
  never create two native providers of `ExpoAutoAttendance`.
- Require real Kotlin/Swift builds and upgrade/device checks for readiness. H's
  native test specification remains unexecuted until a real harness exists.
- Do not publish or commit as part of this handoff. Update release readiness
  from evidence, not from successful TypeScript packaging alone.

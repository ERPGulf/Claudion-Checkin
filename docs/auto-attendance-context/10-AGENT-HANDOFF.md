# Agent handoff

> Start with [12-HYBRID-RELIABILITY-FIXES.md](12-HYBRID-RELIABILITY-FIXES.md) for the follow-up hybrid fixes against committed baseline `14828da`, schema v6, acceptance-time/session guards, scoped manual requests, native registration changes and current validation limits.

> Historical baseline at `de722c9`. Read [11-RELIABILITY-FIXES.md](11-RELIABILITY-FIXES.md) for the current fixes, regression results, native-build limits and physical-device validation plan. Source line anchors below refer to the baseline.

This is the current implementation at `de722c954621bd0eeb980917f397677df9bdc69e`, investigated 2026-10-13. Only these context documents were created. No fixes, application tests, builds, device runs, API calls, commit, or push were performed. The two untracked characterization suites and pre-existing `docs/auto-attendance-sdk/` were preserved. Source facts are not claims of working native/live behavior.

## 1. Technical architecture

Persisted app login mounts `AutoAttendanceBootstrap` independently of screens. The optional Expo module detects/persists one latest native transition; JavaScript submits punches through shared durable session authority. Online auto attendance uses `autoCheckInOut`; eligible automatic failures become SQLite rows. A separate session-scoped JS sync manager sends one row per offline request and records acceptance evidence. Android receiver does not boot JS; iOS app-owned runtime attempts a React root during a region/FCM wake without a scene. [App.js:182](../../App.js#L182), [bootstrap:86](../../components/AutoAttendanceBootstrap.jsx#L86), [session:259](../../utils/attendanceSessionState.js#L259), [runtime:46](../../ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift#L46).

## 2. Main files and responsibilities

| Read first | Why it matters |
| --- | --- |
| [AutoAttendanceBootstrap.jsx:149](../../components/AutoAttendanceBootstrap.jsx#L149) | Runtime gating, registration, ENTER/EXIT, replay, queue ordering, presence reconciliation. |
| [useAutoAttendance.js:61](../../hooks/useAutoAttendance.js#L61), both AutoAttendance screens | UI permissions, opt-in, policy/status refresh, development controls; both variants share behavior. |
| [AutoAttendanceSlice.js:55](../../redux/Slices/AutoAttendanceSlice.js#L55) | Policy 0/1/2, opt-in, logout reset, sync request. |
| [module bridge:17](../../modules/expo-auto-attendance/index.js#L17) | Native availability, exports, event names, old-binary fallbacks. |
| Android [manager:97](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt#L97), [receiver:23](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBroadcastReceiver.kt#L23), [boot receiver:13](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBootReceiver.kt#L13) | Registration, callback persistence/emission, reboot/package restoration. |
| iOS [manager:145](../../modules/expo-auto-attendance/ios/GeofenceManager.swift#L145), [subscriber:13](../../modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift#L13), [runtime:21](../../ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift#L21), [plugin:62](../../plugins/withAttendanceBackgroundRuntime.js#L62) | Core Location, launch delegate priming, background root/scene reuse and native generation. |
| [attendanceSessionState.js:259](../../utils/attendanceSessionState.js#L259), [geofenceEventLog.js:52](../../utils/geofenceEventLog.js#L52) | Shared manual/auto authority, durable legacy compatibility, replay mark/filters. |
| [attendance.service.js:438](../../services/api/attendance.service.js#L438), [apiClient.js:485](../../services/api/apiClient.js#L485) | Online contracts, timestamp resolution, current auth context, refresh/scoped requests. |
| [AttendanceQueueService.js:405](../../services/offline/AttendanceQueueService.js#L405), [offlineAttendanceGate.js:166](../../services/offline/offlineAttendanceGate.js#L166), [attendanceQueueProvenance.js:65](../../services/offline/attendanceQueueProvenance.js#L65) | Admission, manual online-only, cached automatic policy, historical unknown origin. |
| [AttendanceDatabase.js:123](../../services/offline/AttendanceDatabase.js#L123), [repository:324](../../services/offline/AttendanceQueueRepository.js#L324), [sync:402](../../services/offline/AttendanceSyncService.js#L402), [verification:32](../../services/offline/AttendanceVerification.js#L32) | v4 migrations, atomic ordered claims, scoped upload/evidence, no guessing after duplicate. |
| [OfflineAttendanceBootstrap.jsx:76](../../components/OfflineAttendanceBootstrap.jsx#L76), [BackgroundSyncManager.js:213](../../services/offline/BackgroundSyncManager.js#L213), [useAttendanceRecovery.js:35](../../hooks/useAttendanceRecovery.js#L35) | Owner cleanup, JS lifecycle triggers/cancellation, user sync and verification. |

Full catalogue: [01-FILE-INVENTORY.md](01-FILE-INVENTORY.md).

## 3. Critical execution flows

1. **Launch:** app readiness → Redux hydration → independent auto/offline bootstraps → policy/owner/sync setup.
2. **Auto startup:** listeners attach → permission status → employee/office GET + Highest GPS → register only if not stored monitoring → replay last event → reconcile inside presence.
3. **ENTER/EXIT:** native saves one event → emit → `performAttendanceAction` → locked `performSessionTransition` → `submitAutoAttendance` → online success or queue acceptance → durable session → processed mark/Redux; OUT notification.
4. **Queue:** source scope validation → insert/pair → scheduled scoped claim → one-record offline POST → inserted evidence, duplicate-history verification, review, retry/block, or positive rejection.
5. **Logout/switch:** generation invalidation → stop/cancel/clear caches/tokens/Redux → retain queued evidence and device marks; employee-only owner and mobile tenant-clear have distinct semantics.

Exact calls and ordering, including all eighteen requested scenarios: [03-RUNTIME-FLOWS.md](03-RUNTIME-FLOWS.md).

## 4. Business rules and invariants

- Policy 1 monitors and marks without punches; policy 2 permits actions. User opt-in and login are also required. UI feature flag does not stop the bootstrap. [slice:97](../../redux/Slices/AutoAttendanceSlice.js#L97), [bootstrap:224](../../components/AutoAttendanceBootstrap.jsx#L224).
- One nearest office/fence, not multiple-office monitoring. Native transition is trusted for automatic submission; manual location/photo rules are separate. [office scoring:110](../../utils/attendanceLocations.js#L110), [auto API:438](../../services/api/attendance.service.js#L438).
- All manual and automatic punches must use `performSessionTransition({execute})`. Its lock spans submission. **Do not call `readSession()` inside execute.** Queued acceptance is not server confirmation. [session:259](../../utils/attendanceSessionState.js#L259).
- Manual punches remain online-only. Preserve old manual/photo rows, migration SQL, retained queue data, tenant identity, atomic claims, chronological ordering and pairing. [queue service:425](../../services/offline/AttendanceQueueService.js#L425), [database:249](../../services/offline/AttendanceDatabase.js#L249).
- Never assign historical NULL tenant from current login. Never resend an uncertain accepted/duplicate record merely because history search is inconclusive. [provenance:65](../../services/offline/attendanceQueueProvenance.js#L65), [verification:32](../../services/offline/AttendanceVerification.js#L32).
- Preserve endpoint-specific response shapes and one-record offline POST. Refresh stays in `apiClient`; ordinary 403 does not trigger refresh, transient refresh failures retain session, token persistence precedes memory. [AttendanceApi:194](../../services/offline/AttendanceApi.js#L194), [apiClient:156](../../services/api/apiClient.js#L156), [apiClient:565](../../services/api/apiClient.js#L565).

## 5. Android/iOS differences

| Android | iOS |
| --- | --- |
| Play Services PendingIntent ENTER/EXIT; initial ENTER trigger. | Core Location delegate ENTER/EXIT; explicit initial-state request and unknown retries. |
| SharedPreferences single last event and registration flag. | UserDefaults single last event and registration flag. |
| Boot/package receiver re-registers stored fence; no authenticated JS startup path. | App delegate primes manager; app runtime attempts Updates-selected React root during windowless region/FCM wake. |
| Fine + background on applicable Android versions; precise/power/optimization reporting. | Always + full accuracy for start; max-radius clamp, precision/authorization/power warnings. |
| No attendance foreground service/headless worker. | No native attendance URLSession uploader/periodic scheduler/continuous-location loop. |

These describe code. Killed-app, force-stop/force-quit, reboot and background delivery remain **UNVERIFIED**. Read [04 Android](04-ANDROID-IMPLEMENTATION.md) and [05 iOS](05-IOS-IMPLEMENTATION.md) before native edits.

## 6. Dependencies and integration contracts

Expo 57 / React Native 0.86.3 / React 19.2.3, Expo Modules, Location, SQLite, Updates, Notifications, Redux persistence, AsyncStorage, React Query, Axios, NetInfo, geolib, date-fns, Firebase messaging/crash reporting, Play Services Location, and Core Location form the relevant stack. Resolve exact locked versions from `package-lock.json`/`ios/Podfile.lock`, not this prose alone. [package.json:27](../../package.json#L27).

Native API additions must tolerate older binaries; OTA cannot supply missing native classes. Preserve `office-main`, bridge/event names, receiver/subscriber registration, storage keys, native main-queue requirements, FCM wake observers, Firebase initialization, Expo factory ownership, scene root reuse, and plugin reapplication. Align committed Info.plist/Expo.plist with app runtime/channel changes. Do not run clean prebuild over committed app-owned iOS changes without an explicit native-work scope. [bridge:17](../../modules/expo-auto-attendance/index.js#L17), [plugin:42](../../plugins/withAttendanceBackgroundRuntime.js#L42), [README.md:97](../../README.md#L97).

## 7. Known limitations

Most consequential: single-slot capture loss; registration can overwrite pending replay; stored monitoring keeps obsolete fence; unbounded office GPS can delay cold-start replay and unresolved office prevents presence recovery; historical queue rows can be NULL-tenant and block later rows; online OUT can overtake queued IN; global session owner/processed mark/counts are not fully tenant-isolated; presence can reopen manual OUT; offline payload omits `auto`; stop/start and identity-change races; device-global cached policy/time/capability; bounded exact verification; unverified legacy photo seam; potentially sensitive API logging; no evidence purge. These are not all confirmed production defects. Conditions/evidence and OS unknowns: [08-EDGE-CASES-AND-RISKS.md](08-EDGE-CASES-AND-RISKS.md).

## 8. Areas that must not be broken

Preserve QR and mobile authentication/provisioning, refresh token ownership, auth generation cancellation, strict mobile attendance-policy completeness, modern/legacy consumers, theme behavior, feature route registration, safe background navigation, logout FCM guards, retained offline evidence, legacy session keys, migration recovery, automatic/manual session interoperability, no-transport versus internet-probe semantics, and recovery review visibility. Never copy secrets/credentials/employee records into tests, logs, PR descriptions, or these docs. Read repository [AGENTS.md](../../AGENTS.md) for binding constraints; source has some logging limitations already catalogued, which must not be silently treated as a safe convention.

## 9. Tests and validation commands

Read the coverage map and focused/full Jest commands in [09-TESTING-AND-VALIDATION.md](09-TESTING-AND-VALIDATION.md). Start with bootstrap checkout/presence, auto API, replay, session authority, queue repository/migrations/service, offline API/sync/scope/recovery. Native changes need real builds and device tests; JS/native config mocks do not verify wake behavior. Live staging must verify tenant/employee mapping, policy, SDK refresh, actual online/offline API acceptance, timestamps and duplicates.

The untracked characterization/provenance tests specify current limitations and future TODOs. Inspect them without mistaking desired journal/ack APIs for an implemented SDK. Prior reported test results in SDK documents were not rerun here.

## 10. Reading before changing code

Read this handoff → [02 architecture](02-ARCHITECTURE.md) → [03 flows](03-RUNTIME-FLOWS.md) → [06 contracts](06-API-AND-BUSINESS-RULES.md) → [07 queue/recovery](07-OFFLINE-SYNC-AND-RECOVERY.md) → relevant platform document → [08 risks](08-EDGE-CASES-AND-RISKS.md) → [09 validation](09-TESTING-AND-VALIDATION.md), consulting [01 inventory](01-FILE-INVENTORY.md) for sources. Also read AGENTS.md, the applicable CLAUDE architecture/versioning sections, README native/OTA procedures, and DESIGN.md before screen changes. Existing `docs/auto-attendance-sdk/` is supporting extraction planning, not authority for current runtime behavior.

A future coding request must choose its intended behavior explicitly for scope attribution, event retention, stale-event handling, presence reconciliation, ordering, and OS support. This investigation does not authorize implementing any of those changes.

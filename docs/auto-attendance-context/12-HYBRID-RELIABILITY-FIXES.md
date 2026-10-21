# Hybrid attendance reliability — 2026-10-14

Implemented against clean committed baseline `14828da` (the existing durable journal implementation). This report supersedes current-implementation statements in the historical context documents. No commit, push, production request, EAS build, OTA publication or physical-device validation was performed for this task. Confirmed failures below establish code mechanisms; they do not establish which mechanism caused the client's device incident. The 36 m / 354 m location snapshots do not prove delivery of an OS callback.

## A. Fix summary and C. Before/after behavior

| Confirmed issue and reproduction | Correction and resulting behavior |
| --- | --- |
| Manual IN starts at t0, EXIT is captured at t10, HTTP accepts at t20. Recording IN at t20 caused the valid EXIT to be consumed as stale. | Both actual manual entry points use `ManualAttendanceService`, capture device-clock `occurredAt` before asynchronous preparation, and pass it through the real API and shared session commit. The direct action also captures before reading photo mode. EXIT at t10 closes IN at t0 after the held manual submission completes. Truly older EXIT/ENTER receipts remain skipped. |
| A status GET begins during manual upload; its delayed closed response arrives after IN commits. Freezing startedAt alone makes the old startedAt-based guard insufficient. | Add optional durable `committedAt` alongside logical startedAt/endedAt. Requests issued before local acceptance cannot undo that transition, in either direction. Older records retain their existing fallback. The field is internal and is never sent to the backend. |
| Server-time GET is slow. Measuring offset/age at dispatch treats the response's clock as an earlier measurement and moves a frozen punch forward. History also parses a naive server string into a number before normalization, erasing its clock domain. | Measure the returned clock at response observation and include lookup elapsed time in event age. Normalize scoped history while the original representation is available, preserving numeric/explicit-zone instants. The actual status/history path and submitted IN/OUT now use consistent device epochs. Network latency, naive timezone/DST and device-clock changes remain measurement limits, not exactly-once guarantees. |
| Tenant/employee/logout changes during GPS, time lookup, HTTP response, ownership persistence or session storage. An old operation can commit or publish into the new account. | Reuse existing auth-generation/tenant/employee/account scope checks and `attendanceSyncScope` interceptor metadata. Guard both real manual API entry points, office/GPS work, camera status/photo work, session commits, reconciliation, owner writes, status/totals refresh and publication. Remove partial old-scope session/owner writes under the existing session lock. A scope rejected before writing cannot erase a valid current session. A request already dispatched cannot be recalled from the backend. |
| Camera IN accepts; its status PUT runs after releasing the attendance lock and overtakes automatic OUT. | Keep the existing status PUT inside the manual transition's execute callback. A same-runtime EXIT waits until it completes. Attendance remains accepted if the non-scope status/photo work fails, preserving existing warning behavior. Review also caught and corrected a missing origin import introduced during these edits; the skipped-camera regression now passes. |
| Manual OUT commits and awaits break cleanup. Auto ENTER then commits/publishes IN. The delayed manual handler publishes its old OUT. Similar status/camera/native publication seams exist. | `publishCurrentSession` reads and synchronously projects the current durable session while holding the existing transition lock. Keep a newer session's current location. Old-account totals validate inside the helper before dispatching. Punch success messages describe the completed action; the displayed attendance follows the current session. |
| Successful backend response explicitly sets geotagging 0 and employee_locations []; cache retains previous active policy/geometry. | Treat explicit [] as authoritative removal, omitted geometry as same-owner partial data, and explicit policy independently. Connected launch/foreground/reconnect refreshes bounded employee authority before replay. Failed/offline refresh retains proven scoped cache. Mobile sign-in still requires its complete policy; incomplete background data may safely apply explicit disablement without authorizing new attendance. Policy 1 stays warnings-only; policy 2 still requires opt-in. |
| Auto ENTER POST reaches the server but its acknowledgement is lost. Manual fallback has no committed local IN and can send a duplicate; EXIT can lack its parent. | Before conflicting manual work, inspect durable uncertain ingress, preserve original timestamps, and require existing exact positive employee/type/time history evidence or a confirmed source queue row. Positive proof restores the shared session without another IN POST. Missing/unavailable proof stays explicit review/recovery work and retains its EXIT. Absence from limited history is not proof of failure. |
| A strict automatic online timeout falls through to a fresh offline queue row with no dispatch marker; the first queue drain can resend the already committed IN. | Strict dispatched automatic ambiguity stays on its original durable ingress receipt for verification. Genuine offline/pre-dispatch automatic work still uses the existing SQLite outbox. Known classified no-insert refusals retain the established handling. No second outbox is introduced. |
| Another JS context resets a live queue claim; an expired dispatched claim or ambiguous retry can be resent. Historical mixed ID/time ordering can form a dependency cycle after clock correction. | Schema v6 adds owned expiring queue claims and durable upload dispatch evidence. Heartbeats and compare-and-set settlement/release preserve live claims. Expired pre-dispatch claims may retry; dispatched/legacy ownerless claims require positive history. Deterministic historical-before-native precedence preserves historical timestamp order and native insertion order without changing payload times. Manual actions cannot overtake retained same-scope or unknown-tenant dependencies. |
| Android 100.3 m becomes 100.30000305175781 m as Float. Exact comparison rejects its receipt or repeatedly replaces registration. | Preserve requested Double geometry and convert only at the OS API. Accept only the exact platform Float representation or supported radius clamp with matching fingerprint. Migrate old metadata only when its existing scoped fingerprint proves the requested radius; preserve physical IDs and receipts. |
| iOS starts monitoring but dies before confirmation, losing registration ownership. Initial region state stays unknown or never calls back, without a later retry. | Persist pending/monitoring/inactive scoped registration metadata atomically with the existing journal before OS registration. Restore ownership/delegate handling on wake. Persist bounded initial-presence request deadlines/cooldown and expose an optional retry bridge. Authoritative inside creates one initial receipt; outside finishes without an EXIT; unknown never creates attendance. Completion and append are atomic. Late initial presence after a manual checkout does not reopen it; malformed initial metadata stays reviewable and later genuine crossings remain eligible. |

## B. Important files/functions

| Implementation group | Files and important functions |
| --- | --- |
| Manual/session authority | `services/offline/ManualAttendanceService.js`: createManualAttendanceContext, performManualAttendanceTransition; `utils/attendanceSessionState.js`: performSessionTransition, reconcileSessionFromServer, applySessionOwner, publishCurrentSession. |
| Real manual/UI paths | `hooks/useAttendanceAction.js`: primary/direct handlers, scoped status/totals helpers; `screens/AttendanceCamera.jsx`: handleChecking, uploadPicture; both attendance bootstraps: scoped ownership and current-session projection. |
| API/clock | `services/api/attendance.service.js`: userCheckIn, getOfficeLocation, getServerTime, resolveServerTimestampAt, totals/break helpers; employee and upload services: optional existing scope; `utils/serverClock.js`: normalizeAttendanceStatusClock; `offlineAttendanceGate.js`: scoped nearest office. |
| Ingress and outbox | AutoAttendanceEventProcessor: validateEvent, processRow, reconcileUncertainAutoAttendance; EventRepository: listUncertainEvents/claimEvent; QueueService: submitOnlineOnly/submitAttendance; Database v6; QueueRepository owned claims/ordering; SyncService: syncRow/verifyInterruptedUploads. |
| Policy/native registration | attendanceConfigCache refresh/build merge; DurableAutoAttendanceBootstrap refresh/replay order; autoAttendanceRegistration radius matching/optional retry; Kotlin manager/store/module Double radius; four module Swift files pending registration/initial state; optional JS bridge. |

The exact modified-file inventory is included at the end of this report.

## D. Test results and evidence

| Check | Actual result | Boundary |
| --- | --- | --- |
| Full Jest: `npm test -- --runInBand --watchman=false --silent --forceExit` | **101 suites passed; 2,207 tests passed; 13 existing TODOs**; exit 0. Log: `/tmp/claudion-hybrid-final-all-tests.log`. | Includes auth, manual/offline API contracts, real SQLite migration/claims, both UI variants and hybrid regressions. An earlier run without forceExit finished tests but retained asynchronous handles; forceExit is recorded explicitly, not claimed handle-clean validation. |
| Real hybrid hook/API/camera: `npm test -- __tests__/hybridAttendance.integration.test.jsx __tests__/manualAttendanceScope.test.js __tests__/autoAttendanceAmbiguousDispatch.test.js --runInBand --watchman=false --silent` | **3 suites, 25 tests passed**, exit 0. | The hybrid suite has 19 cases. Actual submission/session/ingress/SQLite seams run with synthetic transport/native fixtures; Core Location/Play Services do not. |
| Android journal: `sh modules/expo-auto-attendance/android/journal-tests/run-journal-tests.sh /tmp/attendance-radius-json-20240303.jar` | **16 JVM cases passed**, exit 0. Log: `/tmp/claudion-hybrid-android-harness.log`. | Production store/journal with a filesystem-backed SharedPreferences adapter; no real Android receiver, provider or device scheduling. |
| Android native API compilation | Passed against Android 36, cached Play Services/AndroidX; artifact `/tmp/attendance-radius-api-xfwnr6dz/attendance-native-api.jar`. | Manager/store/journal/receiver APIs compile with an Expo event-constant stand-in. Expo DSL/module integration and the full Gradle application are unverified. |
| Swift harness: `xcrun swiftc -module-cache-path /tmp/claudion-attendance-swift-cache modules/expo-auto-attendance/ios/GeofenceStore.swift native-tests/ios/GeofenceStoreTests.swift -o /tmp/claudion-geofence-store-tests`, then `/tmp/claudion-geofence-store-tests` | **59 Foundation persistence checks passed**, exit 0. Log: `/tmp/claudion-hybrid-ios-harness.log`. | Real atomic file/restart/migration/initial-presence completion/cooldown/cancellation assertions; no Core Location delivery. |
| iOS unsigned native module target | `xcodebuild -project ios/Pods/Pods.xcodeproj -scheme ExpoAutoAttendance -configuration Debug -sdk iphoneos -derivedDataPath /tmp/claudion-ios-native-derived ARCHS=arm64 ONLY_ACTIVE_ARCH=NO OBJROOT=/tmp/claudion-ios-native-derived/Build/Intermediates.noindex SYMROOT=/tmp/claudion-ios-native-derived/Build/Products CLANG_MODULE_CACHE_PATH=/tmp/claudion-ios-native-derived/ModuleCache.noindex SWIFT_MODULE_CACHE_PATH=/tmp/claudion-ios-native-derived/ModuleCache.noindex CODE_SIGNING_ALLOWED=NO build` passed. | iPhoneOS 27 SDK, actual ExpoModulesCore/module sources; log `/tmp/claudion-ios-hybrid-native-build.log` contains BUILD SUCCEEDED. Full app/relaunch/device behavior unverified. |
| Metro: `CI=1 EXPO_NO_DOTENV=1 npx expo export --platform all --output-dir /tmp/claudion-hybrid-final-export` | **Android and iOS Hermes exports passed**, exit 0. Log: `/tmp/claudion-hybrid-final-metro.log`. | Bundle/import/bridge resolution; no OTA publication or live backend proof. |
| Lint: `npm run lint` | **Blocked**, exit 2: ESLint cannot find a configuration file. Log: `/tmp/claudion-hybrid-lint.log`. | Pre-existing repository setup; no successful lint is claimed and no unrelated lint configuration was added. |
| Typecheck | **Not configured**: no script/tsconfig. | Installed TypeScript alone does not establish a checked project. |
| Review | `git diff --check` passed; HEAD remains `14828da`. | 59 modified/new repository files; no commit/push. Exact inventory below. |

Regression-first failures were observed for the real manual upload/EXIT race, tenant changes during GPS/time/HTTP/session/owner writes, uncertain automatic/manual overlap, camera status PUT ordering, delayed status responses, stale UI publication, asynchronous photo-mode preparation, delayed clock measurement, cache revocation, queue claims/ordering/ambiguity, fractional radius matching and malformed initial metadata. Logs are local `/tmp/claudion-*` artifacts. The iOS new persistence harness initially failed compilation because the baseline lacked its new store contracts; that is a missing-contract compile failure, not executed baseline assertion failures. Its final assertions execute production Foundation storage code. No native harness establishes actual OS callback delivery.

Relevant existing suites cover auto IN/OUT, manual/automatic interoperability, duplicate transitions, genuine stale replay, both offline events, restart, native transfer-before-ack, policy/opt-in, denied permission retention, logout/tenant isolation, concurrent ingress/outbox drains, migrations, duplicate history evidence, manual online-only and photo preservation. Historical fixtures were corrected to model issued-after-acceptance GETs and expired pre-dispatch claims rather than assume a live/dispatched claim can be reset. No TODO is counted as tested behavior.

## E. Compatibility and invariants

- Preserve endpoints, payload fields/content types and existing API return shapes, including ordinary totals/break transport fallbacks. Scope invalidation propagates; a failed totals refresh after accepted manual attendance still reports successful attendance. Optional scope/timestamp arguments bind production manual paths; authentication SDK flows and token refresh ownership are unchanged. No backend contract change is made.
- Manual punches remain online-only. Automatic offline admission still uses cached ownership/policy and existing feature/capability gates. Uncertain dispatched requests require verification and are retained rather than guessed/resubmitted.
- Keep the existing attendance_queue outbox, ingress ledger, native journal and shared session authority. Schema v5 to v6 adds claimOwner, claimExpiresAt and uploadAttemptAt; migrations retain old manual/photo/pairing/provenance records. Historical syncing without proof is conservatively reviewable.
- Keep geotagging 0/1/2, user opt-in, location validation, photo requirements, break/shift rules and seconds-resolution timestamps. No GPS snapshot becomes a punch and no new workplace/shift authorization rule is invented.
- Session committedAt and native requested-radius/registration metadata are additive. Legacy session keys/native captures remain readable; optional retry methods tolerate older binaries. Full new native behavior requires the new runtime/builds.

The original five journal findings remain addressed by committed baseline 14828da: append-only native capture, replacement of stale scoped geometry, explicit unknown replay provenance, scoped event/session ownership, and native OUT ordering behind queued IN. This task preserves that pipeline and strengthens fractional geometry, partial writes, historical dependencies and dispatch uncertainty. Retained unknown-tenant historical punches still require review; assigning them to the current tenant is unsafe.

## F. Remaining risks and physical-device plan

Every physical-device row below is **NOT EXECUTED**. Use disposable staging employees, a Google Play Services Android device, an OEM device with restrictive battery behavior and physical iPhones on supported OS versions. Record exact build/runtime, policy/opt-in, authorization/precision, GPS/Wi-Fi/network and power settings. Test radius 100 m and a fractional radius. Permit adequate dwell time; measure receipt delivery rather than infer it from UI distance.

| Scenario | Android expectation/limit | iOS expectation/limit | Required evidence |
| --- | --- | --- | --- |
| Foreground ENTER/EXIT | Registered allowed fence delivers callbacks | Registered allowed region delivers callbacks | One IN/OUT, original times, exact ingress IDs, final durable/Redux state. |
| Background and screen locked | Permission/provider/battery constraints apply | Always/full-precision authorization and OS wake budget apply | Durable capture first; submit only when supported JS execution runs. |
| Removed from recent apps / system-terminated | Receiver may capture with JS absent; submission defers to supported JS replay. OEM behavior can restrict capture. | Region wake/delegate/runtime restoration must be measured. | Native scoped registration and both receipts survive; reopening drains once. |
| Android user force-stop | Unsupported while package remains stopped; Android 15 cancels PendingIntents. Explicit relaunch repairs registration. | Not applicable | No fabricated missing crossings. Verify recovery after user interaction. |
| iOS user force-quit | Not applicable | Apple staff describes region-monitoring relaunch even after force-quit; app-specific delivery/runtime completion remains unverified and throttled. | Separately measure callbacks, native persistence, background root and upload completion. Do not equate this with Android force-stop. |
| Network off: ENTER then EXIT | Provider must still actually deliver callbacks | Core Location must still deliver callbacks | Retain both; ordered automatic queue under policy, or explicit unresolved receipt if admission is unavailable. |
| Network restoration / app opens during sync | Owned claims/replay coexist | Same within granted execution time | Original one-record payloads; IN confirmed before OUT; no duplicate drain. |
| Device reboot and first unlock | Existing boot receiver must restore desired fence; package/provider/permissions matter | Restore saved pending/monitored region and delegate under OS launch conditions | Geometry/scope agree; old receipts remain retained. |
| Permission revoked/restored; GPS disabled/restored | Detection is unavailable/restricted while disabled | Detection is unavailable/restricted while disabled | Captured evidence survives; registration repairs after authorization/service restoration. |
| Repeated/rapid boundaries | Provider latency/coalescing can omit physical movements | Delivery/relaunch throttling can omit rapid movements | Received events ordered/deduped; same-second ambiguity visible; no synthesized events. |
| Manual IN during delayed ENTER/upload; camera PUT/photo; delayed GET | Shared session and causal timestamps | Same | Exactly one legitimate IN/OUT; no stale status/UI overwrite, including after restart. |
| Policy 2→1→0, explicit [], opt-in off; employee/tenant/logout changes | Remove obsolete fence/stop actions, retain old evidence | Same | No disabled-policy punch or cross-scope processing; offline cannot override a successfully observed revocation. |
| Crash after POST before acknowledgement; concurrent runtimes | Retain dispatch evidence, verify exact history | Same | No blind resend; positive proof resumes OUT; missing proof remains reviewable. |

These limits follow [Android geofencing guidance](https://developer.android.com/develop/sensors-and-location/location/geofencing), [Android stopped-state behavior](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state), and [Apple's March 2026 region-monitoring clarification](https://developer.apple.com/forums/thread/818908). The sources describe platform behavior, not successful execution by this app.

Remaining rollout gates: full application builds; actual Android receivers/reboot/OEM restrictions; iOS initial-state unknown/no-callback retries, location launch and its existing 25-second JS runtime budget; staging exact-history/duplicate/photo response shapes and both auth methods; timezone/DST/clock changes and seconds collisions; storage full/corruption; retained unknown historical rows and unresolved dispatched requests. Backend UUID exactly-once behavior has not been established. An absence from bounded history may require administrator evidence and must not authorize resubmission.

Android capture while JavaScript is absent deliberately defers submission; no worker, service, second uploader or new auth system was introduced. If immediate background server submission is required, design a separate testable WorkManager/Headless JS integration that shares this same queue, scopes, claims and verification. Manual sessions still have no explicit workplace/shift association in the existing contract. A backend policy decision is required before adding such a restriction. The session lock serializes one runtime; SQLite claims/order additionally protect queued/ingress work across runtimes. Actual foreground/background runtime overlap remains a device-integration check.

## G. Verdict

**Source and regression verification supports Manual IN → Automatic OUT with delayed ENTER, overlapping same-runtime submissions, duplicate callbacks and application restart when a valid EXIT is delivered and policy permits actions.** The actual hook/API and camera paths are exercised, including held uploads, stale GETs, offline EXIT and reconnect. Uncertain server outcomes remain recoverable explicit review work until positive proof exists. No claim is made that the client's device incident is resolved, that every physical crossing delivers a callback, or that unsupported/stopped states execute attendance.

## H. Deployment requirements

New **Android and iOS native builds are required** for Double-radius ownership and iOS pending-registration/initial-presence recovery. JavaScript session, scope, policy and queue fixes are bundle changes, but an OTA cannot add the native fixes. Native retry is optional for compatibility, not a substitute for rebuilding.

Runtime is now `1.2.1-sdk57-attendance-hybrid-v2` in app.json and committed iOS Supporting/Expo.plist; the ignored generated Android runtime string is aligned locally. Marketing/build counters were left unchanged: before store distribution allocate valid new Android/iOS build numbers and keep committed iOS Info.plist aligned. EAS configuration uses local versions and requires a clean committed tree. No release command was invoked and no commit was made. Publish future OTA updates only to matching channel/runtime after the native build/device/staging gates above pass. Avoid running old code concurrently against migrated v6 storage; downgrade/rollback must be separately tested.

## Exact modified-file inventory

- [__tests__/AttendanceAction.session-timer.test.jsx](../../__tests__/AttendanceAction.session-timer.test.jsx)
- [__tests__/attendanceConfigCache.test.js](../../__tests__/attendanceConfigCache.test.js)
- [__tests__/attendanceDiagnostics.test.js](../../__tests__/attendanceDiagnostics.test.js)
- [__tests__/attendanceQueueClaims.test.js](../../__tests__/attendanceQueueClaims.test.js)
- [__tests__/attendanceQueueMigration.test.js](../../__tests__/attendanceQueueMigration.test.js)
- [__tests__/attendanceQueueRepository.test.js](../../__tests__/attendanceQueueRepository.test.js)
- [__tests__/attendanceRecovery.test.jsx](../../__tests__/attendanceRecovery.test.jsx)
- [__tests__/attendanceSessionAuthority.test.js](../../__tests__/attendanceSessionAuthority.test.js)
- [__tests__/attendanceSessionState.test.js](../../__tests__/attendanceSessionState.test.js)
- [__tests__/attendanceSyncService.test.js](../../__tests__/attendanceSyncService.test.js)
- [__tests__/attendanceTotalsPublication.test.jsx](../../__tests__/attendanceTotalsPublication.test.jsx)
- [__tests__/attendanceTotalsScope.test.js](../../__tests__/attendanceTotalsScope.test.js)
- [__tests__/autoAttendanceAmbiguousDispatch.test.js](../../__tests__/autoAttendanceAmbiguousDispatch.test.js)
- [__tests__/autoAttendanceBootstrap.durable.test.jsx](../../__tests__/autoAttendanceBootstrap.durable.test.jsx)
- [__tests__/autoAttendanceDurableEvents.test.js](../../__tests__/autoAttendanceDurableEvents.test.js)
- [__tests__/autoAttendanceEventProcessor.test.js](../../__tests__/autoAttendanceEventProcessor.test.js)
- [__tests__/autoAttendanceQueueProvenance.test.js](../../__tests__/autoAttendanceQueueProvenance.test.js)
- [__tests__/autoAttendanceRegistration.test.js](../../__tests__/autoAttendanceRegistration.test.js)
- [__tests__/autoAttendanceScopedSession.test.js](../../__tests__/autoAttendanceScopedSession.test.js)
- [__tests__/employeeRequestScope.test.js](../../__tests__/employeeRequestScope.test.js)
- [__tests__/hybridAttendance.integration.test.jsx](../../__tests__/hybridAttendance.integration.test.jsx)
- [__tests__/manualAttendanceScope.test.js](../../__tests__/manualAttendanceScope.test.js)
- [app.json](../../app.json)
- [components/DurableAutoAttendanceBootstrap.jsx](../../components/DurableAutoAttendanceBootstrap.jsx)
- [components/OfflineAttendanceBootstrap.jsx](../../components/OfflineAttendanceBootstrap.jsx)
- [docs/auto-attendance-context/00-OVERVIEW.md](../../docs/auto-attendance-context/00-OVERVIEW.md)
- [docs/auto-attendance-context/10-AGENT-HANDOFF.md](../../docs/auto-attendance-context/10-AGENT-HANDOFF.md)
- [docs/auto-attendance-context/11-RELIABILITY-FIXES.md](../../docs/auto-attendance-context/11-RELIABILITY-FIXES.md)
- [docs/auto-attendance-context/12-HYBRID-RELIABILITY-FIXES.md](../../docs/auto-attendance-context/12-HYBRID-RELIABILITY-FIXES.md)
- [hooks/useAttendanceAction.js](../../hooks/useAttendanceAction.js)
- [ios/ClaudionCheckin/Supporting/Expo.plist](../../ios/ClaudionCheckin/Supporting/Expo.plist)
- [modules/expo-auto-attendance/android/journal-tests/GeofenceJournalHarness.kt](../../modules/expo-auto-attendance/android/journal-tests/GeofenceJournalHarness.kt)
- [modules/expo-auto-attendance/android/journal-tests/README.md](../../modules/expo-auto-attendance/android/journal-tests/README.md)
- [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/ExpoAutoAttendanceModule.kt](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/ExpoAutoAttendanceModule.kt)
- [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt)
- [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt)
- [modules/expo-auto-attendance/index.js](../../modules/expo-auto-attendance/index.js)
- [modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift](../../modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift)
- [modules/expo-auto-attendance/ios/ExpoAutoAttendanceModule.swift](../../modules/expo-auto-attendance/ios/ExpoAutoAttendanceModule.swift)
- [modules/expo-auto-attendance/ios/GeofenceManager.swift](../../modules/expo-auto-attendance/ios/GeofenceManager.swift)
- [modules/expo-auto-attendance/ios/GeofenceStore.swift](../../modules/expo-auto-attendance/ios/GeofenceStore.swift)
- [native-tests/ios/GeofenceStoreTests.swift](../../native-tests/ios/GeofenceStoreTests.swift)
- [screens/AttendanceCamera.jsx](../../screens/AttendanceCamera.jsx)
- [services/api/attendance.service.js](../../services/api/attendance.service.js)
- [services/api/employee.service.js](../../services/api/employee.service.js)
- [services/api/upload.service.js](../../services/api/upload.service.js)
- [services/offline/AttendanceDatabase.js](../../services/offline/AttendanceDatabase.js)
- [services/offline/AttendanceQueueRepository.js](../../services/offline/AttendanceQueueRepository.js)
- [services/offline/AttendanceQueueService.js](../../services/offline/AttendanceQueueService.js)
- [services/offline/AttendanceSyncService.js](../../services/offline/AttendanceSyncService.js)
- [services/offline/AutoAttendanceEventProcessor.js](../../services/offline/AutoAttendanceEventProcessor.js)
- [services/offline/AutoAttendanceEventRepository.js](../../services/offline/AutoAttendanceEventRepository.js)
- [services/offline/ManualAttendanceService.js](../../services/offline/ManualAttendanceService.js)
- [services/offline/attendanceConfigCache.js](../../services/offline/attendanceConfigCache.js)
- [services/offline/offlineAttendanceGate.js](../../services/offline/offlineAttendanceGate.js)
- [utils/attendanceSession.js](../../utils/attendanceSession.js)
- [utils/attendanceSessionState.js](../../utils/attendanceSessionState.js)
- [utils/autoAttendanceRegistration.js](../../utils/autoAttendanceRegistration.js)
- [utils/serverClock.js](../../utils/serverClock.js)

Ignored generated local alignment: `android/app/src/main/res/values/strings.xml` (runtime string only). Dependencies, package-lock, auth SDK integration and unrelated application files were not changed.

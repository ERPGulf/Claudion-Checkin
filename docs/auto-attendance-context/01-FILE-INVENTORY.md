# File inventory

> Historical baseline at `de722c9`. Read [11-RELIABILITY-FIXES.md](11-RELIABILITY-FIXES.md) for the current fixes, regression results, native-build limits and physical-device validation plan. Source line anchors below refer to the baseline.

Investigation date: 2026-10-13. Baseline: `de722c954621bd0eeb980917f397677df9bdc69e`. Status labels: [00-OVERVIEW.md](00-OVERVIEW.md).

## Counting rule

**211 distinct relevant files** are catalogued below: **139 application/native/configuration files**, **52 behavioral test files**, and **20 existing reference documents**. Count each repository-relative file once, including the two pre-existing untracked test files and eleven pre-existing untracked SDK documents. The eleven newly generated context documents are excluded. This is the explicit investigation catalogue, not a count of every transitive dependency or of files all read from first line to last.

The 139-file implementation/configuration boundary includes direct attendance logic and traced integrations for authentication, notifications, feature access, recovery, packaging, and validation. The local native module contributes **17 files**. Supporting themes/assets, general component libraries, unrelated HR services/screens, dependency implementation files, build products, Pods sources, generated root `android/`, and stale `.git-rewrite/` are not counted. Configuration/lockfiles are counted once; no credential-bearing configuration is reproduced.

Discovery searched contents as well as paths: imports, bridge function/listener exports, ENTER/EXIT handlers, registration calls, local persistence, API callers, queue claims and retry triggers, UI feature gates, AppState/auth cleanup, manifest/subscriber linkage, and assertions in tests. A listed reference can be supporting guidance rather than executable evidence. Source links below point to responsibility entry lines, with detailed call-site evidence in the other documents.

| Category | Files |
| --- | ---: |
| Application, UI, state, and shared utilities | 87 |
| Offline services | 16 |
| Native module | 17 |
| Native application, packaging, and validation configuration | 19 |
| Behavioral tests | 52 |
| Existing guidance and supporting context | 20 |
| **Total** | **211** |

## Checkout status and source interpretation

Before investigation, `__tests__/autoAttendance.characterization.test.jsx`, `__tests__/autoAttendanceQueueProvenance.test.js`, and `docs/auto-attendance-sdk/` were already untracked. They were neither created nor edited here. No application tests were run. SDK documents include future architecture and earlier validation reports; proposed journal/acknowledgment APIs are not current module exports. Repository guidance/commentary sometimes describes older queue behavior: current source has v4 tenant provenance and acceptance evidence.

`FcmBootstrap` is a local function in `App.js`, not a separate component file. `utils/LocationServices.js` was found through content search but has no production callers. Expo TaskManager/background location task definitions, an attendance foreground service, Headless JS registration, WorkManager attendance worker, BGTaskScheduler attendance job, and continuous iOS location updates were not found in application code. Negative findings are bounded to the inspected checkout and exclusions above.

## Application, UI, state, and shared utilities

| File and entry line | Responsibility / relevance |
| --- | --- |
| [App.js:182](../../App.js#L182) | Hydration, app-level bootstraps including local FcmBootstrap, cleanup and OTA startup. |
| [components/AutoAttendanceBootstrap.jsx:86](../../components/AutoAttendanceBootstrap.jsx#L86) | Normal geofence registration, live processing, replay and presence recovery. |
| [components/OfflineAttendanceBootstrap.jsx:40](../../components/OfflineAttendanceBootstrap.jsx#L40) | Queueing flag, employee session owner and sync-manager lifecycle. |
| [components/FeatureSettingsBootstrap.jsx:80](../../components/FeatureSettingsBootstrap.jsx#L80) | Tenant/employee feature scope and refresh lifecycle. |
| [components/CrashReportingBootstrap.jsx:1](../../components/CrashReportingBootstrap.jsx#L1) | Adjacent employee/session crash-reporting lifecycle. |
| [screens/AutoAttendance.jsx:137](../../screens/AutoAttendance.jsx#L137) | Modern Auto Attendance consumer of shared hook. |
| [screens/AutoAttendanceLegacy.jsx:228](../../screens/AutoAttendanceLegacy.jsx#L228) | Legacy Auto Attendance consumer of shared hook. |
| [components/AutoAttendance/CollapsibleCard.jsx:1](../../components/AutoAttendance/CollapsibleCard.jsx#L1) | Auto Attendance expandable status/control presentation. |
| [components/AutoAttendance/PolicyOption.jsx:1](../../components/AutoAttendance/PolicyOption.jsx#L1) | Development policy-choice presentation. |
| [components/AutoAttendance/CoordinateField.jsx:1](../../components/AutoAttendance/CoordinateField.jsx#L1) | Development geofence coordinate input. |
| [components/AutoAttendance/EventLogItem.jsx:1](../../components/AutoAttendance/EventLogItem.jsx#L1) | In-memory native-event presentation. |
| [components/AutoAttendance/index.js:1](../../components/AutoAttendance/index.js#L1) | Auto Attendance component exports. |
| [hooks/useAutoAttendance.js:61](../../hooks/useAutoAttendance.js#L61) | Permission/opt-in UI, policy, native status, presence display and dev commands. |
| [redux/Slices/AutoAttendanceSlice.js:55](../../redux/Slices/AutoAttendanceSlice.js#L55) | Persisted policy, opt-in, sync ID and runtime selectors. |
| [screens/AttendanceAction.jsx:73](../../screens/AttendanceAction.jsx#L73) | Modern manual attendance; shared authority interaction. |
| [screens/AttendanceActionLegacy.jsx:69](../../screens/AttendanceActionLegacy.jsx#L69) | Legacy manual attendance; shared authority interaction. |
| [screens/AttendanceCamera.jsx:139](../../screens/AttendanceCamera.jsx#L139) | Manual photo punch and shared transition authority. |
| [hooks/useAttendanceAction.js:72](../../hooks/useAttendanceAction.js#L72) | Manual punches, local/server session reconciliation, timer and breaks. |
| [screens/AttendanceHistory.jsx:51](../../screens/AttendanceHistory.jsx#L51) | Modern combined server/local timeline. |
| [screens/AttendanceHistoryLegacy.jsx:49](../../screens/AttendanceHistoryLegacy.jsx#L49) | Legacy combined server/local timeline. |
| [hooks/useAttendanceHistory.js:37](../../hooks/useAttendanceHistory.js#L37) | Employee queue/history reads, merge, pagination and refresh/sync. |
| [components/AttendanceHistory/AttendanceHistoryCard.jsx:74](../../components/AttendanceHistory/AttendanceHistoryCard.jsx#L74) | Automatic-trigger and synchronization chips. |
| [components/AttendanceHistory/LogCard.jsx:1](../../components/AttendanceHistory/LogCard.jsx#L1) | Legacy attendance history record display. |
| [screens/AttendanceRequest.jsx:1](../../screens/AttendanceRequest.jsx#L1) | Modern correction-request consumer. |
| [screens/AttendanceRequestLegacy.jsx:1](../../screens/AttendanceRequestLegacy.jsx#L1) | Legacy correction-request consumer. |
| [hooks/useAttendanceRequest.js:307](../../hooks/useAttendanceRequest.js#L307) | Correction submission and resolution of rejected queue records. |
| [utils/attendanceRequest.js:1](../../utils/attendanceRequest.js#L1) | Correction request normalization/validation. |
| [screens/Profile.jsx:322](../../screens/Profile.jsx#L322) | Logout cleanup and attendance recovery/settings entry. |
| [components/settings/AttendanceRecoverySetting.jsx:39](../../components/settings/AttendanceRecoverySetting.jsx#L39) | User sync and read-only server verification actions. |
| [components/settings/OfflineSyncSetting.jsx:1](../../components/settings/OfflineSyncSetting.jsx#L1) | Sync-alert preference presentation. |
| [hooks/useAttendanceRecovery.js:15](../../hooks/useAttendanceRecovery.js#L15) | Scoped recovery rows/counts, sync and verification. |
| [hooks/useOfflineStatus.js:49](../../hooks/useOfflineStatus.js#L49) | Queue/connectivity/capability status and notification presentation. |
| [hooks/useOfflineSyncAlerts.js:18](../../hooks/useOfflineSyncAlerts.js#L18) | Subscribed sync-alert preference. |
| [settings/offlineSyncAlerts.js:30](../../settings/offlineSyncAlerts.js#L30) | Persisted presentation preference; does not disable queue/drain. |
| [components/common/OfflineBanner.jsx:170](../../components/common/OfflineBanner.jsx#L170) | Employee-facing queue/connectivity/review banner. |
| [components/common/AttendanceSyncSheet.jsx:198](../../components/common/AttendanceSyncSheet.jsx#L198) | Saved attendance explanations and correction actions. |
| [components/common/index.js:13](../../components/common/index.js#L13) | Offline banner/sync component export wiring. |
| [components/common/ErrorBoundary.jsx:1](../../components/common/ErrorBoundary.jsx#L1) | Navigation error boundary; bootstraps mount outside it. |
| [components/Home/YourLavas.jsx:79](../../components/Home/YourLavas.jsx#L79) | Modern Auto Attendance feature tile. |
| [components/HomeLegacy/YourLavas.jsx:129](../../components/HomeLegacy/YourLavas.jsx#L129) | Legacy Auto Attendance feature tile. |
| [components/Home/QuickAccess.jsx:1](../../components/Home/QuickAccess.jsx#L1) | Modern quick-access route/feature integration. |
| [components/HomeLegacy/QuickAccess.jsx:1](../../components/HomeLegacy/QuickAccess.jsx#L1) | Legacy quick-access route/feature integration. |
| [utils/quickAccess.js:1](../../utils/quickAccess.js#L1) | Feature-aware quick-access filtering. |
| [navigation/app-navigator.jsx:68](../../navigation/app-navigator.jsx#L68) | Auto Attendance route, shared feature gate and variant selection. |
| [navigation/withFeatureGate.jsx:1](../../navigation/withFeatureGate.jsx#L1) | Disabled screen fallback without unregistering route. |
| [navigation/navigator.jsx:15](../../navigation/navigator.jsx#L15) | Persisted login chooses authenticated/auth navigation. |
| [navigation/rootNavigation.js:1](../../navigation/rootNavigation.js#L1) | Session-safe navigation used by adjacent notification flows. |
| [screens/index.js:1](../../screens/index.js#L1) | Auto/manual/history/correction screen exports. |
| [redux/Store.js:16](../../redux/Store.js#L16) | Persisted root Redux state. |
| [redux/RootReducer.js:12](../../redux/RootReducer.js#L12) | Attendance, auto, auth, user and feature reducers. |
| [redux/CommonActions.js:1](../../redux/CommonActions.js#L1) | REVERT_ALL shared logout action. |
| [redux/Slices/AttendanceSlice.js:21](../../redux/Slices/AttendanceSlice.js#L21) | Attendance display/session mirror and break state. |
| [redux/Slices/AuthSlice.js:8](../../redux/Slices/AuthSlice.js#L8) | Persisted login state and logout. |
| [redux/Slices/UserSlice.js:14](../../redux/Slices/UserSlice.js#L14) | Tenant and employee selectors/provisioning state. |
| [redux/Slices/FeatureSettingsSlice.js:1](../../redux/Slices/FeatureSettingsSlice.js#L1) | Feature cache/scope and unknown defaults. |
| [hooks/useFeatureSettings.js:1](../../hooks/useFeatureSettings.js#L1) | Feature-query orchestration and cached failure behavior. |
| [utils/featureSettings.js:62](../../utils/featureSettings.js#L62) | Auto/offline flags, normalization, unknown defaults and route gates. |
| [utils/attendanceSessionState.js:259](../../utils/attendanceSessionState.js#L259) | Durable authority, serialized transitions, reconciliation and owner. |
| [utils/attendanceSession.js:89](../../utils/attendanceSession.js#L89) | Legacy start/checkout timestamps and active-start resolution. |
| [utils/attendanceLocations.js:30](../../utils/attendanceLocations.js#L30) | Authoritative coordinate extraction, radius scoring and nearest office. |
| [utils/geofenceEventLog.js:52](../../utils/geofenceEventLog.js#L52) | Replay filters and device-wide processed timestamp. |
| [utils/autoAttendance.js:53](../../utils/autoAttendance.js#L53) | Display coordinates/name, GPS fallback, monitoring wait and input parsing. |
| [utils/serverClock.js:65](../../utils/serverClock.js#L65) | Persisted server offset and offline wall-clock timestamps. |
| [utils/attendanceHistory.js:291](../../utils/attendanceHistory.js#L291) | Server/local merge, source/trigger/status presentation. |
| [utils/attendanceRecovery.js:2](../../utils/attendanceRecovery.js#L2) | Safe recovery explanation and verification eligibility. |
| [utils/offlineStatus.js:17](../../utils/offlineStatus.js#L17) | Banner phase, saved-row diagnostics and correction presentation. |
| [utils/authSessionGuard.js:1](../../utils/authSessionGuard.js#L1) | Process-local authentication generation/suspension. |
| [utils/provisioning.js:1](../../utils/provisioning.js#L1) | Provisioning/initial authentication-route context. |
| [utils/mobileAuthCrypto.js:1](../../utils/mobileAuthCrypto.js#L1) | Guarded native crypto availability for mobile login. |
| [utils/otaUpdate.js:1](../../utils/otaUpdate.js#L1) | Adjacent startup update/reload decisions. |
| [utils/LocationServices.js:4](../../utils/LocationServices.js#L4) | Location helpers discovered; no production callers found. |
| [hooks/useLogin.js:76](../../hooks/useLogin.js#L76) | QR/password handoff into persisted authenticated session. |
| [hooks/useQrScanner.js:192](../../hooks/useQrScanner.js#L192) | QR tenant/employee provisioning and auth-method persistence. |
| [hooks/useMobileLogin.js:1](../../hooks/useMobileLogin.js#L1) | Mobile flow orchestration leading to attendance policy handoff. |
| [services/api/attendance.service.js:92](../../services/api/attendance.service.js#L92) | Office/status/manual/automatic API and correction contracts. |
| [services/api/employee.service.js:10](../../services/api/employee.service.js#L10) | Employee geotagging/policy retrieval. |
| [services/api/apiClient.js:156](../../services/api/apiClient.js#L156) | Token persistence, request auth, refresh and scoped drain transport. |
| [services/api/authHelper.js:56](../../services/api/authHelper.js#L56) | Current tenant/token/employee request context. |
| [services/api/auth.service.js:8](../../services/api/auth.service.js#L8) | QR token generation and session activation. |
| [services/api/mobileAuth.service.js:210](../../services/api/mobileAuth.service.js#L210) | Mobile identity/policy persistence and tenant session cleanup. |
| [services/api/featureSettings.service.js:24](../../services/api/featureSettings.service.js#L24) | Tenant feature settings endpoint. |
| [services/api/upload.service.js:11](../../services/api/upload.service.js#L11) | Legacy queued/photo file upload and employee-update seam. |
| [services/api/utils.js:2](../../services/api/utils.js#L2) | Backend URL cleanup and form headers. |
| [services/api/errorHelper.js:1](../../services/api/errorHelper.js#L1) | Shared request error normalization. |
| [services/api/index.js:1](../../services/api/index.js#L1) | API barrel used by attendance UI consumers. |
| [services/notifications/localNotifications.js:45](../../services/notifications/localNotifications.js#L45) | Checkout notification permission/channel/presentation. |
| [services/notifications/fcm.service.js:1](../../services/notifications/fcm.service.js#L1) | Background message setup and session-scoped logout cleanup. |

## Offline services

| File and entry line | Responsibility / relevance |
| --- | --- |
| [services/offline/AttendanceDatabase.js:123](../../services/offline/AttendanceDatabase.js#L123) | SQLite v4 schema, migrations and handle lifecycle. |
| [services/offline/AttendanceQueueRepository.js:119](../../services/offline/AttendanceQueueRepository.js#L119) | Dedupe, pairing, atomic claims, status/backoff and recovery SQL. |
| [services/offline/AttendanceQueueService.js:405](../../services/offline/AttendanceQueueService.js#L405) | Automatic admission, manual online-only, queue write and cleanup. |
| [services/offline/AttendanceApi.js:73](../../services/offline/AttendanceApi.js#L73) | One-record offline payload and strict response interpretation. |
| [services/offline/AttendanceSyncService.js:402](../../services/offline/AttendanceSyncService.js#L402) | Scoped single-flight drain and result/evidence handling. |
| [services/offline/AttendanceVerification.js:32](../../services/offline/AttendanceVerification.js#L32) | Exact bounded history matching and explicit guarded reconciliation. |
| [services/offline/attendanceQueueProvenance.js:65](../../services/offline/attendanceQueueProvenance.js#L65) | Captured scope, normalized tenant and auth/identity assertions. |
| [services/offline/BackgroundSyncManager.js:213](../../services/offline/BackgroundSyncManager.js#L213) | JS triggers/timers/listeners, config refresh and cancellation. |
| [services/offline/NetworkListener.js:57](../../services/offline/NetworkListener.js#L57) | Transport predicate and reconnect events. |
| [services/offline/attendanceConfigCache.js:204](../../services/offline/attendanceConfigCache.js#L204) | Employee/tenant policy cache, legacy mirrors and refresh. |
| [services/offline/offlineAttendanceGate.js:166](../../services/offline/offlineAttendanceGate.js#L166) | Cached queue eligibility and GPS tagging/fallback. |
| [services/offline/offlineCapability.js:50](../../services/offline/offlineCapability.js#L50) | Admin admission flag and observed endpoint capability. |
| [services/offline/attendanceErrors.js:224](../../services/offline/attendanceErrors.js#L224) | Recoverable/validation/duplicate classification. |
| [services/offline/attendancePhotoUpload.js:32](../../services/offline/attendancePhotoUpload.js#L32) | Best-effort retained legacy photo upload after acceptance. |
| [services/offline/AttendanceDiagnostics.js:1](../../services/offline/AttendanceDiagnostics.js#L1) | Read-only queue/scope/dependency forensic helpers. |
| [services/offline/index.js:1](../../services/offline/index.js#L1) | Shared offline API exports. |

## Native module

| File and entry line | Responsibility / relevance |
| --- | --- |
| [modules/expo-auto-attendance/index.js:17](../../modules/expo-auto-attendance/index.js#L17) | Optional Expo bridge, functions, fallbacks and listener exports. |
| [modules/expo-auto-attendance/package.json:1](../../modules/expo-auto-attendance/package.json#L1) | Local module metadata. |
| [modules/expo-auto-attendance/expo-module.config.json:1](../../modules/expo-auto-attendance/expo-module.config.json#L1) | Android/Apple module and launch subscriber registration. |
| [modules/expo-auto-attendance/android/build.gradle:18](../../modules/expo-auto-attendance/android/build.gradle#L18) | Android module build and Play Services Location dependency. |
| [modules/expo-auto-attendance/android/src/main/AndroidManifest.xml:1](../../modules/expo-auto-attendance/android/src/main/AndroidManifest.xml#L1) | Permissions and transition/boot receiver declarations. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/ExpoAutoAttendanceModule.kt:83](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/ExpoAutoAttendanceModule.kt#L83) | Expo lifecycle/functions/events and power receiver. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt:97](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceManager.kt#L97) | Play Services start/stop, permissions, reliability and restore. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBroadcastReceiver.kt:23](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBroadcastReceiver.kt#L23) | Transition/error broadcast ingestion, store and bus. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBootReceiver.kt:13](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBootReceiver.kt#L13) | Reboot/package replacement restoration entry. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceEventBus.kt:17](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceEventBus.kt#L17) | Single optional module listener. |
| [modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt:16](../../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt#L16) | SharedPreferences registration and last event. |
| [modules/expo-auto-attendance/ios/ExpoAutoAttendanceModule.swift:32](../../modules/expo-auto-attendance/ios/ExpoAutoAttendanceModule.swift#L32) | Expo lifecycle, main-queue functions and authorization guards. |
| [modules/expo-auto-attendance/ios/GeofenceManager.swift:145](../../modules/expo-auto-attendance/ios/GeofenceManager.swift#L145) | Core Location registration/delegates and initial-state retries. |
| [modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift:13](../../modules/expo-auto-attendance/ios/AutoAttendanceAppDelegateSubscriber.swift#L13) | Prime location manager on stored-monitoring launch. |
| [modules/expo-auto-attendance/ios/GeofenceEventBus.swift:25](../../modules/expo-auto-attendance/ios/GeofenceEventBus.swift#L25) | Wake notification before optional module listener. |
| [modules/expo-auto-attendance/ios/GeofenceStore.swift:14](../../modules/expo-auto-attendance/ios/GeofenceStore.swift#L14) | UserDefaults registration and last event. |
| [modules/expo-auto-attendance/ios/ExpoAutoAttendance.podspec:13](../../modules/expo-auto-attendance/ios/ExpoAutoAttendance.podspec#L13) | Apple platform/dependency/source linkage. |

## Native application, packaging, and validation configuration

| File and entry line | Responsibility / relevance |
| --- | --- |
| [ios/ClaudionCheckin/AppDelegate.swift:17](../../ios/ClaudionCheckin/AppDelegate.swift#L17) | Expo factory, Firebase and runtime launch configuration. |
| [ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift:21](../../ios/ClaudionCheckin/AttendanceBackgroundRuntime.swift#L21) | Windowless wake root, Updates selection and scene reuse. |
| [native/ios/AttendanceBackgroundRuntime.swift:1](../../native/ios/AttendanceBackgroundRuntime.swift#L1) | Runtime template; byte-equal to committed source at inspection. |
| [plugins/withAttendanceBackgroundRuntime.js:62](../../plugins/withAttendanceBackgroundRuntime.js#L62) | Scene/AppDelegate/Xcode/template integration and guardrails. |
| [ios/ClaudionCheckin/Info.plist:53](../../ios/ClaudionCheckin/Info.plist#L53) | Location/motion descriptions, owned scene and background modes. |
| [ios/ClaudionCheckin/Supporting/Expo.plist:1](../../ios/ClaudionCheckin/Supporting/Expo.plist#L1) | Committed Updates runtime configuration. |
| [ios/ClaudionCheckin/ClaudionCheckin.entitlements:1](../../ios/ClaudionCheckin/ClaudionCheckin.entitlements#L1) | Production APNS capability for adjacent runtime wake. |
| [ios/ClaudionCheckin/ClaudionCheckin.dev.entitlements:1](../../ios/ClaudionCheckin/ClaudionCheckin.dev.entitlements#L1) | Development APNS capability. |
| [ios/ClaudionCheckin.xcodeproj/project.pbxproj:438](../../ios/ClaudionCheckin.xcodeproj/project.pbxproj#L438) | Runtime compile-source and application build settings. |
| [ios/Podfile:1](../../ios/Podfile#L1) | Committed CocoaPods/Expo native linking input. |
| [ios/Podfile.lock:39](../../ios/Podfile.lock#L39) | Resolved local native module and native dependency linkage. |
| [app.json:15](../../app.json#L15) | Location/native plugins, scene integration, permissions and OTA runtime. |
| [eas.json:1](../../eas.json#L1) | Build/update channel context; no remote command run. |
| [package.json:27](../../package.json#L27) | Runtime/development dependencies and scripts. |
| [package-lock.json:1](../../package-lock.json#L1) | Locked dependency resolution; metadata inspected, not whole dependency source. |
| [.gitignore:1](../../.gitignore#L1) | Generated root Android/build artifacts exclusion. |
| [jest.config.js:1](../../jest.config.js#L1) | Expo preset, stale snapshot exclusion and ESM entry transforms. |
| [jest.setup.js:1](../../jest.setup.js#L1) | Global JS/native test mocks. |
| [test-utils/expoSqliteMock.js:1](../../test-utils/expoSqliteMock.js#L1) | sql.js SQLite test adapter for jsdom suites. |

## Behavioral tests

| File and entry line | Responsibility / relevance |
| --- | --- |
| [__tests__/AutoAttendanceBootstrap.checkout.test.jsx:1](../../__tests__/AutoAttendanceBootstrap.checkout.test.jsx#L1) | Automatic/manual session transitions, replay and OUT notification assertions. |
| [__tests__/AutoAttendanceBootstrap.presence.test.jsx:198](../../__tests__/AutoAttendanceBootstrap.presence.test.jsx#L198) | Inside-presence startup, server/queue guards and monitoring assertions. |
| [__tests__/autoAttendanceSlice.test.js:17](../../__tests__/autoAttendanceSlice.test.js#L17) | Policy/opt-in/logout/sync-ID selectors and reducers. |
| [__tests__/autoAttendanceUi.test.jsx:1](../../__tests__/autoAttendanceUi.test.jsx#L1) | Shared hook wiring and modern/legacy UI assertions. |
| [__tests__/autoCheckInOut.test.js:1](../../__tests__/autoCheckInOut.test.js#L1) | Automatic online payload/time/response contract. |
| [__tests__/geofenceEventLog.test.js:1](../../__tests__/geofenceEventLog.test.js#L1) | Replay age/future/processed timestamp handling. |
| [__tests__/autoAttendance.characterization.test.jsx:233](../../__tests__/autoAttendance.characterization.test.jsx#L233) | PRE-EXISTING UNTRACKED: current lifecycle limitations and future TODOs. |
| [__tests__/autoAttendanceQueueProvenance.test.js:166](../../__tests__/autoAttendanceQueueProvenance.test.js#L166) | PRE-EXISTING UNTRACKED: SQL provenance/order/metadata/review characterization. |
| [__tests__/offlineGateGeofence.test.js:1](../../__tests__/offlineGateGeofence.test.js#L1) | Automatic non-radius admission versus manual location rules. |
| [__tests__/resolveNearestOffice.test.js:1](../../__tests__/resolveNearestOffice.test.js#L1) | Online/cached nearest-office fallback. |
| [__tests__/attendanceConfigCache.test.js:1](../../__tests__/attendanceConfigCache.test.js#L1) | Policy cache, normalization and mirrors. |
| [__tests__/attendanceQueueService.test.js:1](../../__tests__/attendanceQueueService.test.js#L1) | Manual online-only, automatic fallback and cleanup retention. |
| [__tests__/attendanceQueueRepository.test.js:1](../../__tests__/attendanceQueueRepository.test.js#L1) | SQLite dedupe/order/claim/pair/status/backoff. |
| [__tests__/attendanceQueueMigration.test.js:86](../../__tests__/attendanceQueueMigration.test.js#L86) | Retained historical data and v1-v4 schema/rollback. |
| [__tests__/attendanceOfflineApi.test.js:1](../../__tests__/attendanceOfflineApi.test.js#L1) | Bulk record and response interpretation contracts. |
| [__tests__/attendanceSyncService.test.js:1](../../__tests__/attendanceSyncService.test.js#L1) | Drain outcomes, ordering and concurrency. |
| [__tests__/offlineAttendanceErrors.test.js:1](../../__tests__/offlineAttendanceErrors.test.js#L1) | Failure-kind/class and duplicate classifier. |
| [__tests__/offlineCapability.test.js:1](../../__tests__/offlineCapability.test.js#L1) | Capability cache and admin flag. |
| [__tests__/offlineQueueRecovery.test.js:1](../../__tests__/offlineQueueRecovery.test.js#L1) | Queue wake/recovery scheduling behavior. |
| [__tests__/offlineStrandedQueue.test.js:1](../../__tests__/offlineStrandedQueue.test.js#L1) | Long-lived pending work and wake repairs. |
| [__tests__/attendanceRecovery.test.jsx:97](../../__tests__/attendanceRecovery.test.jsx#L97) | Scoped user sync, exact verification, uncertain outcomes and UI. |
| [__tests__/attendanceDiagnostics.test.js:1](../../__tests__/attendanceDiagnostics.test.js#L1) | Read-only queue forensic output. |
| [__tests__/attendanceRequestScope.test.js:27](../../__tests__/attendanceRequestScope.test.js#L27) | Tenant identity, token rotation and logout/switch request guards. |
| [__tests__/attendanceAuthRecovery.integration.test.js:1](../../__tests__/attendanceAuthRecovery.integration.test.js#L1) | Shared auth/queue/presence recovery contracts. |
| [__tests__/attendanceExpiryRecovery.test.js:1](../../__tests__/attendanceExpiryRecovery.test.js#L1) | Expiry cleanup and retained queue recovery. |
| [__tests__/apiClient.test.js:1](../../__tests__/apiClient.test.js#L1) | Authenticated transport, ordinary status and refresh behavior. |
| [__tests__/sessionResilience.test.js:1](../../__tests__/sessionResilience.test.js#L1) | Transient auth failures and retained session context. |
| [__tests__/attendanceSessionState.test.js:1](../../__tests__/attendanceSessionState.test.js#L1) | Durable state, migration, lock and transition decisions. |
| [__tests__/attendanceSessionAuthority.test.js:1](../../__tests__/attendanceSessionAuthority.test.js#L1) | Shared authoritative state and reconciliation. |
| [__tests__/attendanceStatusUnavailable.test.js:1](../../__tests__/attendanceStatusUnavailable.test.js#L1) | Unknown server status must not blindly reset local state. |
| [__tests__/AttendanceAction.session-timer.test.jsx:1](../../__tests__/AttendanceAction.session-timer.test.jsx#L1) | Manual UI timer restoration against session authority. |
| [__tests__/AttendanceAction.break-rules.test.jsx:1](../../__tests__/AttendanceAction.break-rules.test.jsx#L1) | Adjacent manual break/punch rules. |
| [__tests__/attendanceHistory.test.js:1](../../__tests__/attendanceHistory.test.js#L1) | History transformation/source display. |
| [__tests__/attendanceHistoryMerge.test.js:1](../../__tests__/attendanceHistoryMerge.test.js#L1) | Server/local timeline identity, ordering and loaded window. |
| [__tests__/attendanceHistoryRefresh.test.jsx:1](../../__tests__/attendanceHistoryRefresh.test.jsx#L1) | History refresh and sync integration. |
| [__tests__/attendanceHistoryUi.test.jsx:1](../../__tests__/attendanceHistoryUi.test.jsx#L1) | Modern/legacy timeline display. |
| [__tests__/attendanceRequestUi.test.jsx:1](../../__tests__/attendanceRequestUi.test.jsx#L1) | Correction UI and rejected-row resolution integration. |
| [__tests__/offlineStatus.test.js:1](../../__tests__/offlineStatus.test.js#L1) | Offline/recovery banner phases and saved-row explanations. |
| [__tests__/offlineBannerUi.test.jsx:1](../../__tests__/offlineBannerUi.test.jsx#L1) | Banner visibility/action/presentation. |
| [__tests__/attendanceScenePlugin.test.js:12](../../__tests__/attendanceScenePlugin.test.js#L12) | Plugin idempotency, scene/factory/linking guardrails. |
| [__tests__/nativeConfiguration.test.js:16](../../__tests__/nativeConfiguration.test.js#L16) | Native text/config consistency; not actual native execution. |
| [__tests__/otaUpdate.test.js:1](../../__tests__/otaUpdate.test.js#L1) | Startup update/reload context. |
| [__tests__/localNotifications.test.js:1](../../__tests__/localNotifications.test.js#L1) | Local notification permission/channel/presentation. |
| [__tests__/fcm.service.logout.test.js:1](../../__tests__/fcm.service.logout.test.js#L1) | Session-guarded notification cleanup. |
| [__tests__/fcm.service.test.js:1](../../__tests__/fcm.service.test.js#L1) | Adjacent Firebase registration/session behavior. |
| [__tests__/fcm.service.notifications.test.js:1](../../__tests__/fcm.service.notifications.test.js#L1) | Adjacent background notification handling. |
| [__tests__/featureSettings.test.jsx:1](../../__tests__/featureSettings.test.jsx#L1) | Feature settings normalization/cache/visibility. |
| [__tests__/featureLabels.test.js:1](../../__tests__/featureLabels.test.js#L1) | Attendance feature labels/route presentation. |
| [__tests__/quickAccessOptions.test.js:1](../../__tests__/quickAccessOptions.test.js#L1) | Feature-aware Home route filtering. |
| [__tests__/serverClock.test.js:1](../../__tests__/serverClock.test.js#L1) | Offset capture, persistence and naive timestamp formatting. |
| [__tests__/authProvisioning.test.jsx:1](../../__tests__/authProvisioning.test.jsx#L1) | QR/mobile provisioning compatibility. |
| [__tests__/mobileAuthSession.test.js:1](../../__tests__/mobileAuthSession.test.js#L1) | Identity/policy/token handoff and tenant-session cleanup. |

## Existing guidance and supporting context

| File and entry line | Responsibility / relevance |
| --- | --- |
| [AGENTS.md:1](../../AGENTS.md#L1) | Repository constraints; implementation verified when queue prose differs. |
| [CLAUDE.md:77](../../CLAUDE.md#L77) | Architecture and release/versioning context. |
| [README.md:97](../../README.md#L97) | Native build, notifications and OTA procedures. |
| [DESIGN.md:1](../../DESIGN.md#L1) | Required guide before future screen restyling; supporting reference. |
| [AUTH_CAFM_GAP_ANALYSIS.md:1](../../AUTH_CAFM_GAP_ANALYSIS.md#L1) | Mobile authentication rollout/contract differences. |
| [docs/mobile-sign-in.md:1](../../docs/mobile-sign-in.md#L1) | Mobile identity/policy/refresh live-validation blockers. |
| [docs/attendance-sync-forensic-audit.md:18](../../docs/attendance-sync-forensic-audit.md#L18) | Queue investigation context; do not reproduce customer details. |
| [docs/expo-native-upgrade-audit.md:34](../../docs/expo-native-upgrade-audit.md#L34) | Preservation of module/native application integration. |
| [docs/expo-sdk57-migration.md:1](../../docs/expo-sdk57-migration.md#L1) | Expo/RN migration and native integration context. |
| [docs/auto-attendance-sdk/00-SDK_CONTEXT.md:1](../../docs/auto-attendance-sdk/00-SDK_CONTEXT.md#L1) | PRE-EXISTING UNTRACKED: SDK extraction context, not implemented SDK. |
| [docs/auto-attendance-sdk/01-SOURCE_INVENTORY.md:1](../../docs/auto-attendance-sdk/01-SOURCE_INVENTORY.md#L1) | PRE-EXISTING UNTRACKED: supporting discovery inventory. |
| [docs/auto-attendance-sdk/02-RUNTIME_FLOWS.md:1](../../docs/auto-attendance-sdk/02-RUNTIME_FLOWS.md#L1) | PRE-EXISTING UNTRACKED: supporting flow descriptions. |
| [docs/auto-attendance-sdk/03-NATIVE_REQUIREMENTS.md:1](../../docs/auto-attendance-sdk/03-NATIVE_REQUIREMENTS.md#L1) | PRE-EXISTING UNTRACKED: proposed native requirements/OS context. |
| [docs/auto-attendance-sdk/04-SDK_ARCHITECTURE.md:1](../../docs/auto-attendance-sdk/04-SDK_ARCHITECTURE.md#L1) | PRE-EXISTING UNTRACKED: proposed extraction architecture. |
| [docs/auto-attendance-sdk/05-EXTRACTION_PLAN.md:1](../../docs/auto-attendance-sdk/05-EXTRACTION_PLAN.md#L1) | PRE-EXISTING UNTRACKED: future extraction steps. |
| [docs/auto-attendance-sdk/06-TESTING_AND_RISKS.md:1](../../docs/auto-attendance-sdk/06-TESTING_AND_RISKS.md#L1) | PRE-EXISTING UNTRACKED: historical testing/risk notes. |
| [docs/auto-attendance-sdk/07-OPEN_QUESTIONS.md:1](../../docs/auto-attendance-sdk/07-OPEN_QUESTIONS.md#L1) | PRE-EXISTING UNTRACKED: unresolved product/SDK choices. |
| [docs/auto-attendance-sdk/08-M0-VALIDATION.md:1](../../docs/auto-attendance-sdk/08-M0-VALIDATION.md#L1) | PRE-EXISTING UNTRACKED: historical characterization report; not rerun here. |
| [docs/auto-attendance-sdk/09-SDK-DECISIONS.md:1](../../docs/auto-attendance-sdk/09-SDK-DECISIONS.md#L1) | PRE-EXISTING UNTRACKED: future SDK decisions, not current runtime APIs. |
| [docs/auto-attendance-sdk/10-M1-IMPLEMENTATION-HANDOFF.md:1](../../docs/auto-attendance-sdk/10-M1-IMPLEMENTATION-HANDOFF.md#L1) | PRE-EXISTING UNTRACKED: future journal/acknowledgment handoff. |

## Fast navigation by task

- Registration, policy, live/replay/presence: auto bootstrap, shared hook/slice, office API, event log and session authority.
- Android delivery/restoration: module, manager, transition/boot receivers, bus/store and manifest.
- iOS wake: manager/subscriber/bus, AppDelegate, runtime/template, plugin and scene/build configuration.
- Offline provenance/order/retry: database/repository, queue service, scope guards, API/sync/verifier and manager.
- Employee-facing recovery: recovery hook/setting, offline hook/banner/sheet, history merge and correction hook.
- Authentication/tenant changes: QR/login/mobile handoff, auth generation, request client, profile cleanup and offline session owner.

Use [03-RUNTIME-FLOWS.md](03-RUNTIME-FLOWS.md) for execution order rather than treating inventory order as call order.


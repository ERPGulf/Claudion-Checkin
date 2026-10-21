# 06 — Testing Matrix and Risk Register

Tags: **[V]** verified in code, **[P]** platform documentation (see [03 §8](03-NATIVE_REQUIREMENTS.md)), **[I]** inference, **[D]** needs device/backend confirmation.

Test levels:

| Code | Level | Tooling |
| --- | --- | --- |
| **U** | JS unit / integration | Jest (`jest-expo`), React Native Testing Library; queue suites need `@jest-environment jsdom` + `test-utils/expoSqliteMock.js` (sql.js) |
| **NU** | Native unit | Kotlin JVM tests (Robolectric for `Context`/SharedPreferences), XCTest |
| **NI** | Native integration on emulator/simulator | Android emulator (Google APIs image) with `adb emu geo fix`, `adb shell cmd location`, `am force-stop`, `dumpsys deviceidle`; iOS Simulator with simulated locations/GPX |
| **RD** | Real device | Physical Android (stock + at least one aggressive OEM) and iPhone, real movement or controlled mock location |
| **X** | Not reliably testable in a simulator | Must be RD, often repeated over days |

Current coverage **[V]**: 86 Jest suites; the automatic-attendance-specific ones are listed in [01 §4](01-SOURCE_INVENTORY.md) and below. **There are no native (Kotlin/Swift) tests** — `GeofenceManager.decideInitialState` is pure but untested. The SDK 57 migration matrix (`docs/expo-sdk57-migration.md` rows 11-18, 24) records physical-device geofence checks as **pending**.

---

## 1. Test matrix

### 1.1 Registration and status

| ID | Scenario | Android | iOS | Level | Existing coverage |
| --- | --- | --- | --- | --- | --- |
| R-1 | Register with fine/Always + precise | Fence added, flag true | Region monitored, flag true | NU, NI, RD | JS mocks only (`AutoAttendanceBootstrap.presence`) |
| R-2 | Missing background permission | `ERR_BACKGROUND_LOCATION_PERMISSION` | same | NU, NI | none native |
| R-3 | Precise off / approximate only | `ERR_LOCATION_PERMISSION` (fine missing) | `ERR_REDUCED_ACCURACY` | NI, RD | none |
| R-4 | Concurrent `startGeofence` | Second call replaces | Rejected "already in progress" | NU | none |
| R-5 | Register while inside | `INITIAL_TRIGGER_ENTER` → ENTER | `requestState` → synthetic ENTER | NI, RD | presence tests (JS) |
| R-6 | Initial state `.unknown` | n/a | Retries at 2/4/8 s then settles | NU (`decideInitialState`) | none |
| R-7 | Radius larger than iOS maximum | n/a | Clamped, stored clamped | NU | none |
| R-8 | `isMonitoring()` truth after OS drops fence | Flag true, nothing registered | Flag true | NI, RD | none — **gap** |
| R-9 | Status/warnings | Battery Saver `-2`, battery optimization query | Low Power `-2`, auth `-1`, precise `-3` | NI, RD | UI vocabulary only (`autoAttendanceUi`) |

### 1.2 Transitions by application state

| ID | Scenario | Expected today **[V]** | Level |
| --- | --- | --- | --- |
| T-FG | ENTER/EXIT with app foreground | Live listener → transition → API | NI, RD |
| T-BG | App backgrounded, process alive | Same; subject to Doze/suspension | RD |
| A-KILL-1 | Android, process dead, one transition | Persisted; submitted on next app open (≤ 24 h) | RD |
| A-KILL-2 | Android, ENTER then EXIT while dead | Only EXIT persisted; replay SKIPS → no attendance | RD, U (characterization) |
| I-KILL-1 | iOS, terminated, one transition | Background relaunch → windowless React → replay → submit (if within background time) | RD, X |
| I-KILL-2 | iOS, ENTER then EXIT while terminated | Each wake should process; if JS does not finish, later event overwrites earlier | RD, X |
| I-FQ | iOS force-quit then crossing | Contested: Apple staff say relaunch, app copy says no **[P]/[D]** | RD, X |
| A-FS | Android force stop then crossing | Fences removed **[P]**; ≤ 14 no re-registration; 15+ `BOOT_COMPLETED` re-registers | RD |
| T-LOCK | Device locked | Delivered; JS processing as T-BG/I-KILL-1 | RD |
| T-REBOOT | Reboot then crossing | Android restores stored fence (initial ENTER if inside); iOS keeps region, works after first unlock **[P]** | RD |
| A-UPG / I-UPG | App upgrade | Android re-registers via `MY_PACKAGE_REPLACED` (required **[P]**); iOS region persists | RD |
| A-NA | Location services off → on (`GEOFENCE_NOT_AVAILABLE`) | `onError` only; fences gone **[P]**; never re-registered | NI, RD |
| A-PERM / I-PERM | Revoke and re-grant background permission | No re-registration after re-grant (flag true) | NI, RD |
| I-PRECISE | Precise turned off after registration | `-3` warning only; region monitoring unavailable **[P]** | RD |
| PWR | Low Power / Battery Saver / Doze / OEM killer | Delays or suppression **[P]/[D]** | RD, X |
| I-BAR | Background App Refresh off | Archived docs: no region wake **[P]** | RD |
| T-FLAP | Walking along the boundary | Multiple IN/OUT pairs (no dwell) **[I]** | RD, X |
| T-LAT | Delivery latency | Android 2–6 min background; iOS 3–5 min avg **[P]** | RD, X |

### 1.3 Attendance logic (JS)

| ID | Scenario | Level | Existing |
| --- | --- | --- | --- |
| L-1 | Manual IN → automatic OUT closes it | U | ✔ `AutoAttendanceBootstrap.checkout` "checks out automatically when the user leaves after checking in manually" |
| L-2 | Automatic OUT after manual OUT is skipped | U | ✔ |
| L-3 | Duplicate EXIT, re-entry while session open | U | ✔ |
| L-4 | Refused automatic OUT leaves session open | U | ✔ |
| L-5 | Warnings-only never logs; raising policy does not replay a handled crossing | U | ✔ |
| L-6 | Policy raised between a **killed-app** crossing and its replay | U | ✘ **gap** (today the policy at processing time applies) |
| L-7 | Replay: once only, 24 h window, future timestamp, EXIT before open session, retry after failure | U | ✔ `AutoAttendanceBootstrap.checkout`, `geofenceEventLog` |
| L-8 | Presence: inside at start → IN; outside → nothing; queue-first; server-open restore; offline fallback | U | ✔ `AutoAttendanceBootstrap.presence` |
| L-9 | Presence after a **manual check-out** while inside | U | ✘ **gap** (code re-checks-in) |
| L-10 | Backdating: server clock − device age; fallbacks | U | ✔ `autoCheckInOut` |
| L-11 | `auto: true` on automatic, `false` on manual | U | ✔ `autoCheckInOut` |
| L-12 | Session machine rules, lock serialization, reconcile guards, owner switch | U | ✔ `attendanceSessionState`, `attendanceSessionAuthority` |
| L-13 | Office location changed while monitoring | U | ✘ **gap** (fence never updated) |

### 1.4 Offline, retry, duplicate and sync

| ID | Scenario | Level | Existing |
| --- | --- | --- | --- |
| O-1 | No transport → automatic punch queued → reconnect drains | U, RD | ✔ queue/sync suites; RD pending |
| O-2 | 5xx/timeout online → queued | U | ✔ `attendanceQueueService` |
| O-3 | Validation refusal online → not queued (FAILED) | U | ✔ |
| O-4 | Retry ladder, cap 15 → blocked, blocked ladder floor | U | ✔ `attendanceSyncService`, `offlineQueueRecovery` |
| O-5 | Endpoint missing → capability false → new punches refused, old rows retained | U | ✔ `offlineCapability` |
| O-6 | IN behind undelivered punch is force-queued; OUT never | U | ✔ `AutoAttendanceBootstrap.checkout` |
| O-7 | Replayed transition queued → `tenantKey NULL` → not drained, blocks younger rows | U | ✘ **gap** (characterize in M0) |
| O-8 | Process killed mid-sync → `releaseStuckSyncing` | U, RD | ✔ unit |
| O-9 | Duplicate response verified / unverified → synced / needs_review | U | ✔ |
| O-10 | No cached configuration → offline automatic refused | U | ✔ `offlineGateGeofence` |
| O-11 | Captive-portal network (validated=false, traffic works) | RD | ✔ unit for predicate; RD pending |
| O-12 | Uncertain commit (server stored, client timed out) → queued with different timestamp | U, staging | ✘ **gap** |
| O-13 | Admin offline switch off → no queueing; drain continues | U | ✔ |

### 1.5 Identity, logout and tenancy

| ID | Scenario | Level | Existing |
| --- | --- | --- | --- |
| ID-1 | Manual logout: queue kept, config/capability cleared, fence stopped | U | partial (`fcm.service.logout`, recovery suites) |
| ID-2 | Forced logout on terminal refresh failure | U | ✔ `attendanceExpiryRecovery`, `sessionResilience` |
| ID-3 | Different employee logs in → session cleared; other rows skipped | U | ✔ `attendanceSessionState` (`applySessionOwner`), `attendanceAuthRecovery.integration` |
| ID-4 | Tenant change on mobile sign-in clears session | U | ✔ `mobileAuthSession` |
| ID-5 | Employee B replays employee A's unprocessed native event | U | ✘ **gap** |
| ID-6 | Login after logout leaves `userEnabled = false` | U | partial (`autoAttendanceSlice` REVERT_ALL) |

### 1.6 Build and integration

| ID | Scenario | Level | Existing |
| --- | --- | --- | --- |
| B-1 | Module autolinked once; receivers/permissions merged | CI build | ✔ `nativeConfiguration` (source-level) |
| B-2 | iOS pod static framework, Swift 5.9, iOS 16.4 | CI build | manual |
| B-3 | Background-runtime plugin idempotent, refuses unknown layouts | U | ✔ `attendanceScenePlugin` |
| B-4 | JS on a binary without the module → `isAvailable()` false, screen fallback | U | ✔ screen branch; add explicit test |
| B-5 | Runtime version alignment (`app.json` vs `Expo.plist`) | U | ✔ `nativeConfiguration` |
| B-6 | New Architecture + Hermes release build | CI | ✔ builds noted in migration docs |
| B-7 | Host without Expo prebuild (committed `ios/`) applies plugin effects | Manual review | doc only |

### 1.7 What a simulator can and cannot do

| Capability | Android emulator | iOS Simulator |
| --- | --- | --- |
| Set location / route | Yes (`adb emu geo fix`, Extended Controls, GPX) | Yes (Features → Location, GPX) |
| Geofence/region callbacks | Usually, with Google APIs image; timing unrealistic | Region monitoring partially works; timing unrealistic |
| Reboot, force stop, permission revoke, location off | Yes (`adb reboot`, `am force-stop`, `pm revoke`, `cmd location set-location-enabled false`) | Erase/restart only; permissions via Settings |
| Doze / standby buckets | Approximated (`dumpsys deviceidle force-idle`, `am set-standby-bucket`) | n/a |
| Background relaunch after termination | Process start for broadcast works | Not reliable; DEBUG probe `CLAUDION_TEST_BACKGROUND_STARTUP=1` exercises only the windowless startup path |
| Real GPS accuracy, indoor drift, boundary flapping, OEM killers, iOS launch throttling, Low Power/BAR effects, real latency | **No** | **No** |

---

## 2. Risk register

Severity reflects impact on payroll correctness × likelihood. "Existing" = present in today's app; "SDK" = risk created by extraction/design.

### 2.1 Reliability

| ID | Sev. | Type | Finding | Evidence |
| --- | --- | --- | --- | --- |
| RK-01 | **Critical** | Existing | **Unattributed replay rows stall an employee's automatic attendance.** A transition replayed after a cold start (`occurredAt < scopeObservedAt`) is processed with `sourceScope: null`; if it is queued it gets `tenantKey = NULL`. Scoped drains never claim it, yet it blocks every younger row of that employee (`older.tenantKey IS NULL` in the dependency SQL) and is counted in `mayAffectServerCount` (not tenant-scoped). Consequences: later automatic INs are force-queued behind it and never sent, `reconcilePresence` never opens a session, and — because OUT is never force-queued — later OUTs reach the server **before** their INs. Recovery UI says "will not be resent automatically". `needs_review` rows produce the same stall. Typical trigger: iOS background relaunch with poor connectivity. | `AutoAttendanceBootstrap.jsx:163, 237-238, 266-267`; `AttendanceQueueService.js:210-216, 505-508`; `AttendanceQueueRepository.js:119-133, 336-340, 1033-1103`; `utils/attendanceRecovery.js:3-6` — static trace, **no test** |
| RK-02 | High | Existing | Android performs no JS work when the process is not running; attendance waits for the next app open; only the last transition survives (ENTER+EXIT while killed → no attendance). | `GeofenceBroadcastReceiver.kt:57-77`, `GeofenceStore.kt:57-63`, `MainApplication.kt` (lazy `reactHost`) |
| RK-03 | High | Existing | Single-slot native store on both platforms: any transition JS has not processed is overwritten by the next one. | `GeofenceStore.kt/.swift` |
| RK-04 | High | Existing | `isMonitoring()` is a persisted flag. After the OS drops fences (`GEOFENCE_NOT_AVAILABLE`, Play services data clear, Android ≤ 14 force stop, permission revoke, iOS reduced accuracy, backup restore) JS never re-registers; the UI still shows "Monitoring". | `AutoAttendanceBootstrap.jsx:466-474`; platform docs |
| RK-05 | High | Existing | The fence is never updated while monitoring: changed coordinates/radius or a newly nearest office are ignored until off/on or re-login; presence uses the new nearest office, so check-in and check-out can come from different places. | `AutoAttendanceBootstrap.jsx:458-474, 525-615` |
| RK-06 | High | Existing | iOS background budget: JS startup waits for fonts, hydration and an OTA check (possibly a reload), then an employee fetch and an **unbounded Highest-accuracy GPS fix** before replay; a 25 s background task caps the windowless start; the suspended-wake path has no background task. | `App.js:133-176`; `attendance.service.js:196-198`; `AttendanceBackgroundRuntime.swift:54-59` |
| RK-07 | Medium-High | Existing | Presence reconciliation runs on every launch/wake and re-checks-in an employee who checked out manually while still inside the fence. | `AutoAttendanceBootstrap.jsx:525-615, 629-641` — **no test** |
| RK-08 | Medium | Existing | Any logout, including forced logout on token expiry, resets `userEnabled` and stops monitoring; it never resumes without user action. | `AutoAttendanceSlice.js:75`, `apiClient.js:204-208, 353-380` |
| RK-09 | Medium | Existing | No dwell, debounce or minimum session: boundary flapping yields multiple IN/OUT pairs. | `GeofenceManager.kt:106-118`; no JS debounce |
| RK-10 | Medium | Existing | Uncertain commit: an online submit that times out after the server stored it is queued with a different timestamp (offline offset vs server-derived), so duplicate detection by timestamp fails; no idempotency key on either endpoint. | `attendance.service.js:458`; `serverClock.js:111-115`; `AttendanceApi.js:83-99` |
| RK-11 | Medium | Existing | A refused (FAILED) transition is retried only if it is still the native last event at the next launch. | `AutoAttendanceBootstrap.jsx:294-314`, `geofenceEventLog.js` |
| RK-12 | Medium | Existing | Receiver persists with `SharedPreferences.apply()` (asynchronous) **[D]**. | `GeofenceStore.kt:36-39, 62` |
| RK-13 | Medium | Existing | Only one office (nearest at registration) is monitored. | bootstrap, `index.js:26` |
| RK-14 | Medium | Existing | Killed-app crossings are judged by the policy at processing time, not at crossing time. | `AutoAttendanceBootstrap.jsx:224-230` |
| RK-15 | Medium | Existing | Platform latency/thresholds: Android 2–6 min in background; iOS 3–5 min average, ~200 m / 20 s, launch throttle, network required **[P]**. | [03](03-NATIVE_REQUIREMENTS.md) |
| RK-16 | Low | Existing | iOS `pendingStart` has no timeout. | `GeofenceManager.swift:158-161` |
| RK-17 | Low | Existing / SDK | iOS `CLLocationManager` is lazy; a JS-thread status call could create it off the main run loop **[I]**. | `GeofenceManager.swift:23-27`; module sync functions |
| RK-18 | Low | Existing | Android `startGeofence` with a new identifier adds a second fence; only one is stored. | `GeofenceManager.kt:120-131` |
| RK-19 | Low | Existing | `hasWorkDue` sees due rows a claim cannot take (NULL-tenant blocker) → empty drain runs every minute. | `AttendanceQueueRepository.js:1215-1237` |
| RK-20 | Medium | SDK | Renaming Kotlin classes, prefs or UserDefaults keys orphans registered fences and flags on upgrade. | [05 M1](05-EXTRACTION_PLAN.md) |
| RK-21 | Medium | SDK | Two copies of the session lock (app util + SDK) would break serialization between manual and automatic punches. | `attendanceSessionState.js:174-183` |
| RK-22 | Low | SDK | iOS `stop()` with no stored id stops every circular region in the app, including other libraries'. | `GeofenceManager.swift:211-218` |

### 2.2 Security and isolation

| ID | Sev. | Type | Finding | Evidence |
| --- | --- | --- | --- | --- |
| RK-30 | Medium | Existing | Cross-employee replay: native last event and `autoAttendanceLastProcessedEventAt` are device-global and survive logout; employee B can replay employee A's unprocessed transition within 24 h. | `geofenceEventLog.js:100-102` (no caller), `GeofenceStore.*` |
| RK-31 | Medium | Existing | No spoofing defence: mock locations trigger geofences; automatic punches skip the radius gate by design and send the **office** coordinates, so the server cannot verify the device position. | `autoCheckInOut` L470-479; `offlineAttendanceGate.js:207-210` |
| RK-32 | Low | Existing | Native payload identifier is not validated against the registered fence. | bootstrap L359-366 |
| RK-33 | Medium | Existing | QR re-provisioning relies on employee-code comparison for session ownership; codes can collide across tenants. | `attendanceSessionState.js:442-465`; comment in `mobileAuth.service.js:303-312` |
| RK-34 | Low | Existing | Tokens live in AsyncStorage (app concern); the SDK must never store credentials. | `apiClient.js` |
| RK-35 | Low | Existing | Tenant keys accept `http:` origins; queued uploads go to the tenant key origin. | `attendanceQueueProvenance.js:20` |

### 2.3 Privacy and store policy

| ID | Sev. | Type | Finding | Evidence |
| --- | --- | --- | --- | --- |
| RK-40 | Medium | Existing | Release builds log the full employee record, coordinates and payloads (`console.log` is not stripped; native `Log.i`/`NSLog` include coordinates). | `attendance.service.js:118-121, 154, 203-206, 481`; `GeofenceManager.kt:123`; `GeofenceManager.swift:263-266`; `babel.config.js` |
| RK-41 | Medium | Existing | Purpose strings mention "drivers during trips"; `NSMotionUsageDescription` declares motion use that no code performs. | `app.json:17, 74-78`; Info.plist |
| RK-42 | Medium | Existing | Google Play background-location prominent disclosure is a short caption shown after enabling **[D]**. | `AutoAttendance.jsx:337-363` |
| RK-43 | Medium | Existing | Queue rows (with device coordinates for queued automatic punches) are retained indefinitely; no user-facing deletion. | `AttendanceQueueRepository.js:821`; `purgeAttendanceQueue` unused |
| RK-44 | Low | Existing | `android:allowBackup="true"`: prefs, AsyncStorage and the queue DB may be backed up/restored **[I]**. | generated manifest |

### 2.4 Maintainability

| ID | Sev. | Type | Finding | Evidence |
| --- | --- | --- | --- | --- |
| RK-50 | Medium | Existing | No native unit tests; physical-device geofence checks pending since the SDK 57 migration. | repo; `docs/expo-sdk57-migration.md` matrix |
| RK-51 | Medium | Existing | Orchestration lives in a React component coupled to Redux, so it cannot run headless. | `AutoAttendanceBootstrap.jsx` |
| RK-52 | Medium | Existing / SDK | iOS background runtime depends on Expo SDK 57 internals and an RNFirebase notification name. | runtime + plugin |
| RK-53 | Low | Existing | Untyped JS API; no ESLint config or typecheck in the repo. | `CLAUDE.md`, `AGENTS.md` |
| RK-54 | Medium | SDK | Host dependency conflicts (`play-services-location`, `expo-modules-core` versions). | module `build.gradle` |

---

## 3. Must-pass gates before SDK v1 is used in production

1. M0 characterization suite green; all existing suites green.
2. Device rows: R-1, R-5, T-FG, T-BG, A-KILL-1, A-KILL-2, I-KILL-1, I-KILL-2, T-REBOOT, A-UPG, I-UPG, A-FS, A-NA, A-PERM, I-PERM, I-PRECISE, O-1, O-11 on at least one stock Android, one aggressive-OEM Android and one current iPhone.
3. Upgrade-in-place test from the current store build (fences and pending events carried over).
4. Staging backend: online automatic punch with `auto: true`; queued punch via the bulk endpoint; duplicate and validation responses.
5. Log audit: no coordinates, tokens or employee records in release logs from SDK code.

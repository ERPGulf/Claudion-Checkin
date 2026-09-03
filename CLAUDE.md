# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`claudion-checkin` is an Expo (SDK 54, bare workflow — has committed `android/` and `ios/` native projects) React Native employee attendance app for ERPGulf. The backend is a **Frappe/ERPNext** server: every API call hits `employee_app.*` (and a few other app) method endpoints, and responses are nested under `data.message` or `data.data`. The app is **multi-tenant** — there is no hardcoded backend; the server URL is provisioned per-device via QR scan.

## Commands

```bash
npm start                    # expo start (Metro)
npm run android              # expo run:android (native build)
npm run ios                  # expo run:ios (native build)
npm run lint                 # eslint . --ext .js,.jsx
npm run lint:fix
npm test                     # jest (all tests)
npx jest __tests__/apiClient.test.js          # single test file
npx jest -t "session timer"                    # single test by name
```

EAS / OTA (see README.md for the full OTA testing workflow):

```bash
npm run eas:build:preview              # build both platforms, preview channel
npm run eas:update:preview -- --message "..."   # publish OTA to preview channel
npm run eas:update:production -- --message "..."
```

`eas.json` sets `requireCommit: true`, so EAS builds need a clean git working tree. Channels: `development` / `preview` / `production`.

## Architecture

### Authentication & onboarding (QR → token)
1. A QR scan (`QrScan` screen) stores `baseUrl`, `api_key`, `app_key` in AsyncStorage. There is no server URL in code.
2. `Login` takes the user's password and calls `generateToken({ api_key, app_key, api_secret: password })` ([services/api/auth.service.js](services/api/auth.service.js)) → `employee_app.gauth.generate_token_secure`, which returns `access_token` / `refresh_token`. These are saved via `saveTokens()` and dispatched into Redux (`setSignIn`).
3. `selectIsLoggedIn` in [redux/Slices/AuthSlice.js](redux/Slices/AuthSlice.js) is the single source of truth for which navigator renders.

### Networking layer ([services/api/](services/api/))
- [apiClient.js](services/api/apiClient.js) is the axios instance with all auth wiring. The **request interceptor** reads `baseUrl` from AsyncStorage at call time and sets `config.baseURL`; the **response interceptor** handles 401/403 by refreshing the token (`employee_app.gauth.create_refresh_token`), with a `failedQueue` so concurrent requests share one refresh, plus terminal-failure handling (`hasTerminalSessionFailure`, `MAX_REFRESH_RETRIES`) that calls `expireSession()` → `clearStore()` (dispatches `setSignOut` + `revertAll`).
- Set header **`x-skip-auth: "true"`** to bypass the auth header AND the refresh logic — used for `generateToken`. `plainAxios` is a separate bare instance used by token refresh and FCM (no interceptors).
- **Convention:** most service functions also manually read `baseUrl`/`access_token` from AsyncStorage and build a full `http://...` URL and set the `Authorization` header themselves, even though the interceptor would do it. Follow the existing pattern in the relevant `*.service.js` when adding endpoints.
- [index.js](services/api/index.js) re-exports every service both as named exports and as a default namespaced object (`api.attendance.userCheckIn`, etc.). Each domain has its own file: `attendance`, `auth`, `employee`, `expense`, `leave`, `trip`, `complaint`, `qr`, `records`, `notification`, `upload`.
- Token masking, server-message parsing, and request/error debug logging helpers live in apiClient.js; reuse them rather than re-logging raw tokens.

### State (Redux Toolkit + redux-persist)
[redux/Store.js](redux/Store.js) persists the **entire** root reducer to AsyncStorage (key `root`). Reducers ([redux/RootReducer.js](redux/RootReducer.js)): `user`, `userAuth`, `attendance`, `quickAccess`, `notification`. The `REVERT_ALL` action ([redux/CommonActions.js](redux/CommonActions.js)) is handled by every slice via `extraReducers` to reset state on logout — dispatch it (through `clearStore`) rather than purging manually.

### Navigation ([navigation/](navigation/))
`Navigator` swaps `AuthNavigator` ↔ `AppNavigator` on `isLoggedIn`. **Navigation from outside React** (FCM handlers, interceptors) must go through [rootNavigation.js](navigation/rootNavigation.js): `navigateSafely(route, params)` checks readiness and queues a pending navigation if the tree/route isn't mounted yet, flushed by `NavigationContainer`'s `onReady`/`onStateChange`. Route names contain spaces (e.g. `"Attendance action"`, `"Leave request"`) — match them exactly.

### Push notifications ([services/notifications/fcm.service.js](services/notifications/fcm.service.js))
Uses `@react-native-firebase/messaging` (modular API). `registerBackgroundMessageHandler()` is called at module load in [App.js](App.js); `FcmBootstrap` runs `initializeFcm()` **only when logged in** and tears it down on logout. The service handles permissions (incl. Android 13 `POST_NOTIFICATIONS` and iOS APNS registration), token persistence, foreground/background/opened/initial-notification routing, backend token registration, **topic subscription sync** (diffed against `fcm_topics` in AsyncStorage via [utils/fcmTopics.js](utils/fcmTopics.js)), and unread-count sync into Redux. The backend registration method is configured in `app.json` → `expo.extra.fcmRegistrationMethod`.

### Attendance domain logic
[utils/attendanceSession.js](utils/attendanceSession.js) is pure, well-tested logic for resolving the active check-in session start time from noisy inputs (server status, persisted AsyncStorage time, Redux time) — it normalizes unix-seconds vs ms, rejects future/pre-checkout timestamps, and is the basis for the session timer.

[utils/attendanceSessionState.js](utils/attendanceSessionState.js) is the durable `CHECKED_OUT ⇄ CHECKED_IN` state machine that **both** entry points drive — the manual screens and the geofence listeners. Every check-in/out goes through `performSessionTransition({ type, origin, execute })`, which refuses illegal moves (so duplicate check-ins/check-outs never reach the backend), serializes concurrent attempts, and commits only after the API accepts. Because the record stores the session `origin` (`MANUAL`/`AUTO`/`UNKNOWN`), a geofence EXIT closes whatever session is open — this is what makes manual check-in → automatic check-out work — and is a no-op after a manual check-out. The record lives in AsyncStorage (`attendanceSessionState`), not Redux, because the listeners run after an OS background relaunch; Redux mirrors it (`attendance.sessionOrigin`) for the UI. `reconcileSessionFromServer()` re-aligns it with `resolveActiveSessionStart()` on screen mount/focus.

The OS delivers ENTER/EXIT to native code even when the app is killed, but the attendance call needs JS — so `AutoAttendanceBootstrap` replays the last native transition (`getLastEvent()`) at launch, gated by the high-water mark in [utils/geofenceEventLog.js](utils/geofenceEventLog.js) (`autoAttendanceLastProcessedEventAt`) and capped at `MAX_REPLAY_AGE_MS`. Replayed logs are **backdated** to the real crossing: `autoCheckInOut({ occurredAt })` → `resolveServerTimestampAt()` subtracts the event's device-measured age from the server's wall clock, so device/server clock skew cannot shift the logged time. Location-restricted check-in ([attendance.service.js](services/api/attendance.service.js) `getOfficeLocation`/`userCheckIn`) uses `geolib` distance against `employee_locations`, gated by `restrict_location` / `unrestricted_checkout_location` flags cached in AsyncStorage.

### Offline attendance ([services/offline/](services/offline/))
Manual and automatic attendance both work with no connection. The integration seam is `performSessionTransition({ execute })`: `submitAttendance()` ([AttendanceQueueService.js](services/offline/AttendanceQueueService.js)) wraps the existing `userCheckIn` / `autoCheckInOut` call and returns the *same* `{ allowed }` contract, so an offline punch opens a real session and a geofence EXIT still closes it. The state machine, its lock and its duplicate-move rules are untouched. All three entry points (manual hook, camera, geofence) pass through it; they differ only in `attendanceType`.

- **Decision order:** transport present (`shouldAttemptRequest`, NOT `isOnline` — see below) → run the real call, unchanged (`add_log_based_on_employee_field`); it fails → classify ([attendanceErrors.js](services/offline/attendanceErrors.js)). Transport/5xx queues it; a policy or validation refusal is surfaced. Offline → skip the request and go straight to the gate. `userCheckIn`/`autoCheckInOut` now attach the original `error` to their failure result purely so this classification is possible — nothing else reads it.
- **The gate applies offline** ([offlineAttendanceGate.js](services/offline/offlineAttendanceGate.js)), against cached config + a local GPS fix, or aeroplane mode is a bypass for `restrict_location`. `resolveNearestOffice()` is the offline-safe replacement for `getOfficeLocation` at the two places that ask *before* a check-in — a thrown network error there used to leave `inTarget` false and **disable the check-in button**.
- **No cached config = no offline attendance.** [attendanceConfigCache.js](services/offline/attendanceConfigCache.js) caches employee identifiers, locations, radii and policy flags, replacing the blob *only* on a successful download, and mirrors the legacy per-key AsyncStorage values. A device that has never been online refuses with `NO_CONFIG_MESSAGE`.
- **Queue:** SQLite (`attendance_queue`, schema v2). Local dedupe is a UNIQUE index on `(employeeId, timestamp, action)`, not a read-then-write check; the drain claims rows with an atomic `UPDATE … RETURNING` so two JS contexts can't take the same punch. Sync is one row per request via `add_offline_employee_checkins` — its `inserted` array can't be correlated back to a mixed batch.
- **Four failure states, not two.** `pending` (transient, fast ladder) → `blocked` (server can't accept it *yet*: endpoint not deployed, auth, config — kept forever, slow ladder decaying to a 6h floor, woken on launch/reconnect/token-refresh) → `rejected` (server never will — kept, never retried, resolvable only by an attendance correction) → `resolved` (superseded by a correction request, kept for audit). **Nothing reaches `rejected` except a positive match on a known validation message** ([attendanceErrors.js](services/offline/attendanceErrors.js)) — Frappe answers 417 for "method not found", "employee inactive" *and* duplicates alike, so status codes can't separate them and the fallback is always `blocked`. A wrong `blocked` costs a background request; a wrong `rejected` abandons payroll data.
- **A blocked row halts the drain.** The same server refuses the next row identically, so continuing spends one pointless request per punch. Halting also preserves FIFO.
- **A stranded `pending` row is repaired, and it used to freeze the employee's whole queue.** `wakeBlocked` covers `blocked` and `releaseStuckSyncing` covers `syncing`; nothing moved a `pending` row's `nextAttemptAt`, and because `claimNextPending` claims strictly in order, one row scheduled into the far future — what a device clock running ahead leaves behind when it corrects — held back every later punch that employee had made, all of them reading "Pending sync" with nothing to explain it. `wakePending` now runs on every drain, repairing only rows scheduled beyond the ladder's own maximum (an honest backoff is left alone), and `syncNow` passes `wakeAllPending` so an explicit pull makes every pending row due.
- **Queueing a punch asks for a drain**, 3s later (`registerQueueDrainHandler` in [AttendanceQueueService.js](services/offline/AttendanceQueueService.js) → `handleQueuedPunch` in [BackgroundSyncManager.js](services/offline/BackgroundSyncManager.js)). Nothing used to: a row waited for the next launch, foreground or 5-minute tick, and `reconnect` cannot help when the punch was queued because the *server* was unreachable rather than the transport — there is no connectivity edge to fire on. A callback rather than a direct call because importing the manager here would close an import cycle, and `notifyQueueChanged` can't serve (it fires for the drain's own writes, so draining on it re-enters the drain). Three seconds rather than zero because the punch reached the queue *from* a request that just failed; a **successful** online punch kicks it too (`reason: "online-punch"`), since a punch that just landed is the strongest evidence there is that the server is up and this token works.
- **Delivery is tuned for latency, not for sparing the server.** Retry ladder `5s → 15s → 45s → 2m → 5m` (repeating) with `MAX_RETRIES` 15, so a row keeps getting quick attempts for just under an hour before it is parked as `blocked` — the same patience the old `30s → 1h` ladder had, spent as many fast tries instead of a few slow ones. Blocked ladder `1m → 5m → 20m → 1h` floor (was 6h, which could leave a punch waiting most of a working day after the fix that would have let it through was already deployed). Foreground heartbeat 60s, affordable because a run with nothing due returns after one indexed query (`hasWorkDue`, scoped to the employee to match `claimNextPending`) — no NetInfo call, no request, and no log line unless there is actually an unresolved row. What was **not** traded for speed, because none of it is padding: FIFO order, the single-flight lock and atomic claim, duplicate-is-success, one row per request, the `blocked`-never-`rejected` fallback, and halting the run on the first transient failure (the next row fails identically, and the whole queue retries seconds later anyway).
- **Every run logs one line, including the runs that do nothing.** The summary log used to be gated on something having happened, so the one case that mattered — a queue that is not moving — logged nothing, and "never attempted", "attempted forty times" and "the drain never ran" were indistinguishable from off-device. `logRun` reports the trigger, whether it ran, the counts and the **head row** (`peekNextRow`) with its status, attempts, due time and `error`.
- **Session integrity.** A queued check-out is paired to its check-in (`sessionId` / `pairedAttendanceId`) at enqueue time, derived from the **queue table**, never from the session state machine — `performSessionTransition` holds its lock across `execute()` and `readSession()` takes that same lock, so reading it there deadlocks. If a check-in is rejected, `markRejected` cascades to the paired check-out (`failureClass: dependent`) so the server never receives an OUT with no IN, and one correction resolves the pair.
- **A duplicate is success.** "already has a log with the same timestamp" is the expected result of retrying a request that committed then timed out; the row is marked synced with `duplicate = 1`, never retried.
- **Counts are named, never shared.** `countByStatus` returns `pendingCount` / `blockedCount` / `rejectedCount` / `unresolvedCount` / `awaitingServerCount`. The last one **excludes rejected** and is the only one the attendance screen's reconnect guard may use — counting a rejected row there holds a session open forever on a punch the server has already refused.
- **Tenant capability probe** ([offlineCapability.js](services/offline/offlineCapability.js)). `endpoint-missing` is a fact about the *deployment*, not the punch, so it's recorded once. On a server without the endpoint the app stops queueing (refuses honestly with `OFFLINE_UNSUPPORTED_MESSAGE` rather than promising a sync that can't happen) and the administrator banner goes quiet — otherwise every employee sees a permanent notice none of them can clear. Existing rows are kept and still retried; one success flips it back and the queue drains itself. Tri-state: `null` (unknown) is **not** `false`, or a first-launch outage would disable the feature. Cleared on logout — the next login may be a different tenant.
- **Profile → "Offline sync alerts"** ([offlineSyncAlerts.js](settings/offlineSyncAlerts.js)) hides the administrator banner only. It can **never** hide `needs-correction` — that one is the employee's to act on, and a switch that could bury it would let someone lose a day's pay tidying their UI. Display-only; records are always kept, retried and shown in history.
- **Recovery is automatic; there is no Retry button.** For blocked rows retry is already happening, and a button would imply the employee was holding it up; for rejected rows it would fail every time. The sheet ([AttendanceSyncSheet.jsx](components/common/AttendanceSyncSheet.jsx)) offers a prefilled **attendance request** instead, and `resolveWithCorrection` marks the session resolved on submit. Raw server messages are never shown to employees — `row.error` holds Frappe exception text and stays in logs. The manual drain is the **pull-to-refresh on Attendance History** — `refreshAll` (drain, then refetch), which was written and documented but wired to nothing for a release: the screen passed `onRefresh={refetch}`, so the one gesture available where a stuck punch is visible could only redraw the same chip. It passes `employeeId` explicitly, since without it a pull made while the manager is not running (tenant switch off, employee code not through) finds no scope and refuses silently.
- **Two things make a stuck queue diagnosable from a screenshot.** A `pending` punch outlives the offline banner (the phone is back on wifi) and never reaches the administrator banner (nothing is blocked), so the app said nothing at all about it. `OFFLINE_PHASE.WAITING` ([offlineStatus.js](utils/offlineStatus.js)) speaks once the oldest row has outlived the transient ladder (`STALE_PENDING_MS`, an hour, from `countByStatus().oldestPendingAt`), ranks below every other phase (each of which explains the same records better), is suppressed alongside the administrator banner, and is `actionable` — which is what makes the sheet reachable at all in this state. `describeQueueDiagnostics` then puts `#id · status/failureClass · attempts · next HH:mm` on each row. Still no `row.error`: state, attempts and due time are facts about the queue, the error is Frappe exception text and stays in the log.
- **The queue is reached two ways only:** no transport at all, or the real API was attempted and failed transiently. Never on the strength of a reachability probe — a punch queued while the phone was online is the failure mode this cost a release to learn.
- **Connectivity is one question: is there a transport?** ([NetworkListener.js](services/offline/NetworkListener.js)) `isInternetReachable` is not consulted by anything — it survives only in `getNetworkState()` for logs. On Android it is `NET_CAPABILITY_VALIDATED`, the OS captive-portal probe, and it stays `false` for as long as the device is on a network that blocks Android's check endpoint (firewalled site wifi, some roaming data) while carrying the app's traffic fine. Believing it cost payroll data three ways: the ordinary check-in API was skipped on working connections, the drain then declined to deliver what had been queued, and the banner told the employee they were offline the whole time. `shouldAttemptRequest()`/`fetchShouldAttemptRequest()` are second names for the same predicate, kept because that is the question the service layer is asking — reading `isOnline` there invites someone to reintroduce a probe check. A wrong "there is a transport" costs one failed request and one backoff step; a wrong "we are offline" costs a day's attendance.
- **The admin switch gates queueing, never delivery.** `attendance_action.offline_attendance` used to stop `BackgroundSyncManager` outright while the punch path went on queueing — so a tenant with it off wrote rows nothing would ever drain. It is now mirrored into [offlineCapability.js](services/offline/offlineCapability.js) (`setOfflineQueueingAllowed` / `isOfflineQueueingDisallowed`, tri-state: `null` unknown → permitted, matching `DEFAULT_WHEN_UNKNOWN`) so `submitAttendance` refuses to queue, and the manager keeps running in `drainOnly` mode (no config refresh) so rows queued before the flip still land. `useAttendanceAction` exposes the flag but must not enforce it.
- **Offline timestamps** come from the device clock plus an offset measured on every successful `getServerTime()` ([utils/serverClock.js](utils/serverClock.js)), so a wrong phone clock can't shift a queued punch.
- **History** is one timeline: `mergeQueuedRecords()` folds queue rows in and drops each one as soon as the server returns the same punch (matched on instant + log type), so the status chip disappears without bookkeeping.
- Queue and config are cleared on **both** logout paths (`Profile.handleLogout` and the `registerSessionCleanupHandler` in App.js) — a queued punch would otherwise sync under the next user's token.

**Testing note:** `expo-sqlite` and `expo-location` have default stubs in [jest.setup.js](jest.setup.js). Suites that exercise the real queue override the former with [test-utils/expoSqliteMock.js](test-utils/expoSqliteMock.js) (WASM SQLite via `sql.js`) and **must declare `@jest-environment jsdom`** — under the default `node` environment the WASM runtime fails to open a database and reports an empty error.

### Styling
NativeWind (Tailwind v2) via `nativewind/babel` — `className` props work on RN components; content globs are `screens/`, `components/`, `pages/` only ([tailwind.config.js](tailwind.config.js)). Shared design tokens (`COLORS`, `SIZES`, `SHADOWS`) come from [constants/theme.js](constants/theme.js).

## Testing
Jest with `jest-expo` preset; setup in [jest.setup.js](jest.setup.js) mocks AsyncStorage, `expo-constants`, and `@react-native-firebase/messaging`. Tests live in `__tests__/` and focus on the high-risk pure/async logic (apiClient refresh, FCM handlers, attendance session/break rules) rather than UI rendering.

## Versioning gotcha

`ios/` is committed but `android/` is gitignored, so the two platforms read versions from different places and **app.json is not authoritative for iOS**. `expo-doctor` warns about this ("app config fields that may not be synced in a non-CNG project"): with `ios/` present, EAS Build does not sync the `ios` config block, so anything iOS-related must be edited in the native project by hand.

Bumping a version means editing **six** places (all currently `1.1.10` / build `10` / versionCode `19`):

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


## Implementation Workflow

When implementing a feature:

1. Understand existing screen patterns.
2. Search for similar functionality.
3. Reuse existing services when possible.
4. Reuse existing components before creating new ones.
5. Keep business logic in utils/services.
6. Keep screens focused on presentation.
7. Update tests when modifying critical logic.
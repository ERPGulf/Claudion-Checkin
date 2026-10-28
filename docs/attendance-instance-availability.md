# Automatic attendance instance availability

Automatic attendance now checks the authenticated tenant's existing server-time API before dispatching a new attendance POST. It reuses the native geofence journal, JavaScript receipts, SQLite outbox, session transitions and synchronization coordinator. Manual attendance remains online-only; historical manual and photo rows still use the shared outbox.

## Failure mechanism and change

An available network interface does not establish that a particular ERP instance is reachable. Blocking only an instance's IP/port leaves Wi-Fi connected and need not generate a later NetInfo reconnect event. Previously, an attendance POST could fail after a durable dispatch marker was written. The worker correctly avoided blindly resending it, but the resulting unconfirmed record held later work behind it.

| Situation | Previous behavior | Behavior with preflight |
| --- | --- | --- |
| Device has no transport | Automatic attendance is queued. | Existing queue admission and policy checks apply; no attendance dispatch marker is written for an availability check. |
| Wi-Fi connected; instance blocked before upload | Attendance POST can fail after dispatch evidence is persisted, requiring history verification. | Read-only availability failure keeps definitely-unsent work pending with backoff; attendance POST is skipped and dispatch evidence stays empty. |
| Health API returns 429 or relevant 5xx | Attendance may proceed into an avoidable failure. | Temporary server unavailability schedules a retry without an attendance POST. |
| Health API returns unresolved 401/403 | Could be confused with ordinary connectivity failure. | Authentication is reported separately after existing API-client refresh handling; work is retained. |
| Health endpoint unsupported or response malformed | Availability is unknown. | Compatibility/configuration is reported separately. The instance is not described as offline, and attendance is not dispatched on that evidence. |
| Successful probe followed by failed/lost POST response | The attendance outcome is uncertain. | Outcome remains uncertain. Persisted dispatch evidence still prevents automatic resend; only positive server-history verification confirms it. |
| Older native binary sends a direct POST | Legacy transient failures could fall back to a fresh, unmarked queue row. | An atomically owned direct-dispatch receipt in the existing queue protects the request before transmission; uncertainty is verification-only. |
| Earlier ambiguous record; later pending record | Later work is held by FIFO. | FIFO remains intact. Recovery UI explicitly says newer work is blocked by earlier attendance. |
| Eligible `needs_review` row has no verification reason | Some older rows receive no scheduled verification. | A meaningful reason and bounded read-only history checks keep eligible review evidence discoverable; no automatic POST resend is authorized. |
| Instance recovers while Wi-Fi stays connected | Reconnect alone cannot trigger recovery. | Existing foreground heartbeat, foreground/launch events and Sync now can resume pending work when the worker runs. |

## Availability service and submission sequence

`services/offline/InstanceAvailabilityService.js` resolves the active persisted tenant, employee, account and authentication generation. Callers cannot choose an arbitrary probe URL through attendance payloads. It uses the configured `apiClient` and:

```text
GET {active tenant}/api/method/employee_app.attendance_api.get_server_time
Expected response: data.message.server_time = "YYYY-MM-DD HH:mm:ss[.fraction]"
```

This is the same GET contract used by `getServerTime` in `services/api/attendance.service.js`. Client inspection establishes that this is a read operation and does not submit attendance. Backend implementation, absence of side effects and deployment compatibility across all supported tenants have not been independently verified. An authorized environment must verify those properties before rollout; unsupported endpoints remain an explicit compatibility limitation.

The default probe deadline is **4 seconds**, including scope reads, NetInfo resolution, the HTTP request and API-client interceptor/token-refresh waits. A shorter timeout can be supplied; callers cannot extend the probe beyond that limit. Expired work cannot send a late health request or cache a late success. The existing 401 refresh/replay mechanism remains in `apiClient`; the availability service does not add a second authentication flow.

Concurrent probes share an in-flight request for the same tenant/authentication/network context. Successful results live for **3 seconds** and failures for **1 second**. Tenant, employee, account, auth generation, access token and network revision separate cached results; stale results cannot authorize another scope. Actual attendance transport failure invalidates cached availability. The cache is process-local and contains no durable attendance decision. A cached success is only a short-lived admission check, never proof that a later POST succeeded.

The direct automatic path checks availability before its online callback records dispatch intent. The native event remains durably retained if policy or compatibility prevents admission. Transient unavailability uses the existing SQLite outbox, preserving the original crossing time and allowing an accepted local ENTER to pair with a later EXIT. Cached timestamp fallback uses the originating tenant's clock offset, including legacy queue admission; a previous company's global clock observation cannot stamp a new company's punch.

Older binaries without the additive native journal API retain the existing live-event implementation. Their direct online requests now use an owned receipt in `attendance_queue`, inserted atomically as `syncing` with the exact prepared POST timestamp and dispatch evidence. No worker can claim a temporary pending version of that receipt. A positive acknowledgement settles it as confirmed; an uncertain result becomes verification-only review. Writing an online intent does not grant offline attendance permission. Only a proven no-insert refusal may clear its marker, and offline delivery still requires the existing offline capability and location gate. If that admission is refused, a terminal `cancelled` receipt retains explicit `known-not-inserted` evidence. Historical cancelled rows without that evidence remain reviewable; their outcomes are not invented.

A local source identity based on the validated live tenant/employee scope, original crossing time and direction prevents repeated legacy live delivery from recomputing a different timestamp and posting again. This identifier is never sent to the backend. Historical unattributed `getLastEvent` replay is still retained without adopting the current account.

For an outbox row with no previous upload dispatch, `AttendanceSyncService.syncRow` claims the row, checks instance availability, then rechecks scope/claim ownership before persisting dispatch evidence immediately before the POST. Transient preflight failures use the existing pending backoff with an empty `uploadAttemptAt`; authentication/configuration failures remain retained in an appropriate blocked state. The existing `AttendanceApi.pushCheckin` still sends one row per request to `add_offline_employee_checkins`.

Rows that already have dispatch evidence bypass new-send admission and use exact server-history verification. An empty or incomplete history result does not prove that a POST was never committed. Eligible review records receive scheduled, bounded read-only checks, including older rows with missing reason metadata. They are never made eligible for another POST merely because verification failed.

## Scheduling, status and guarantee boundary

The existing coordinator retains single-flight drains, atomic owned claims, leases, FIFO precedence, pairing and tenant/employee checks. Retry delays remain `5s → 15s → 45s → 2m → 5m`, then the existing slower blocked schedule for uncertain uploads after the fast retry budget. A failed preflight leaves unsent work retryable without a dispatch marker. Positive `Retry-After` response hints are preserved through normal and explicit wakeups. Read-only review rechecks are bounded to at most five outbox rows and five native receipts per run and no more often than once per minute per row. No additional global polling loop or native background scheduling dependency is introduced.

The 60-second heartbeat runs while JavaScript is available in the foreground. Launch, foreground, transport reconnect, token refresh, queue insertion, successful online attendance and explicit Sync now remain synchronization opportunities. Server recovery does not require a new geofence crossing or Wi-Fi reconnect, but immediate delivery while iOS or Android has suspended or terminated the app is not promised. A later native wake or app foreground can resume work.

Profile attendance recovery distinguishes saved work, device offline, instance unavailable, synchronization in progress, unconfirmed upload, server compatibility, review dependencies and confirmed success. A later row held behind an unconfirmed row has no promise of automatic upload. “Check server record” reads history; it does not resend an ambiguous attendance request. Attempt metadata now says “Last sync attempt” because a claimed attempt can end at preflight without an attendance upload.

Without a verified backend idempotency contract, the client cannot guarantee both eventual automatic delivery and exactly-once insertion after every ambiguous POST. A healthy preflight reduces avoidable ambiguous attempts; it cannot close the interval between health check, dispatch-marker persistence, network transmission, server commit and response delivery. Crash safety deliberately preserves uncertainty in that interval.

## Incident records and validation

The reported incident supplied regression scenarios: record **#1**, EXIT at **2026-10-27 09:59:46**, `needs_review`; record **#2**, ENTER at **2026-10-27 10:05:21**, held behind #1; employee **HR-EMP-00052**. The implementation did not reset or resend these records. Subsequently, the user explicitly requested deletion of unsynced Simulator records: those two local rows were backed up and removed, retaining all 16 synchronized rows and the native event ledger. That local cleanup did not resolve or change their backend outcomes.

Automated coverage uses synthetic tenants/credentials, mocked HTTP and an in-memory SQLite fixture. See `instanceAvailability`, automatic event/ambiguous-dispatch suites, queue/sync suites and `attendanceRecovery` tests for coverage of the availability gate, uncertainty boundary and UI. Do not treat those tests as evidence of live tenant compatibility or native-device background execution.

Recovery coverage includes light/dark rendering, preflight outage and unsupported-endpoint UI through the real mocked coordinator, persisted outage copy after remount, source-order dependency descriptions, historical manual recovery, and evidence-gated cancellation labels. The final delivery report records executed suite counts separately from live-device validation.

No dedicated staging instance/employee was supplied. Live firewall tests, broader backend compatibility checks and physical-device validation remain **unexecuted**. The later authorized real-network offline Simulator test is documented below. Use a disposable authorized test employee for the remaining checklist; preserve existing attendance and queues:

1. Confirm the server-time GET contract, authentication refresh, and that repeated reads create no attendance records for each supported tenant, including custom ports.
2. Establish a confirmed ENTER; keep network transport connected and block only the configured test instance. Deliver EXIT and inspect native receipt, SQLite persistence and diagnostic logs. Expect failed health GET, no attendance POST, empty attendance dispatch marker and retained pending work.
3. Remove the instance block without toggling Wi-Fi. Foreground or wait for an existing worker opportunity. Expect successful probe, original-timestamp EXIT upload, positive acknowledgement and no duplicate.
4. Repeat with ENTER and EXIT captured during the outage. Confirm local session pairing and chronological IN → OUT delivery after recovery, including JS/worker restart.
5. Separately test true airplane mode with Wi-Fi also disabled, then restore transport. Confirm the same retained work and policy restrictions. Airplane mode with Wi-Fi enabled is still connected transport.
6. In a controlled mock transport, commit a POST and lose its response. Confirm later attempts read history only, never repeat the POST, and newer work remains held until positive confirmation.
7. On physical iPhone, verify foreground, background, locked screen, OS geofence wake, cold-start replay, offline background crossing and recovery after suspension. Confirm permissions and location accuracy remain unchanged.
8. Repeat native geofence/lifecycle checks on physical Android, including process death and network changes. Simulator results do not establish either platform's physical background reliability.

## Implementation map

| File | Functions and changes |
| --- | --- |
| `services/offline/InstanceAvailabilityService.js` | `checkInstanceAvailability`, `invalidateInstanceAvailability`: active-tenant resolution, bounded read-only probe, classification, deduplication, TTL and stale-result protection. |
| `services/offline/NetworkListener.js` | `getNetworkRevision`, native network notification handling: invalidate availability observations during interface changes without changing reconnect semantics. |
| `services/offline/AttendanceQueueService.js` | `submitAttendance`, automatic `attemptOnline`: preflight before dispatch; durable legacy direct receipt; authorized no-insert fallback; manual branch unchanged. |
| `services/api/attendance.service.js` | `resolveServerTimestampAt`, `autoCheckInOut`: reuse the health clock observation, preserve exact prepared timestamps and invalidate failed availability observations. |
| `services/offline/AutoAttendanceEventProcessor.js` | `processRow`, `drainAutoAttendanceEvents`, review rechecks: safely queue unavailable native crossings; preserve original source/time; reuse positive verification evidence within one drain. |
| `services/offline/AutoAttendanceEventRepository.js` | `listReviewEventsForVerification`: bounded attributable history-only review candidates. |
| `services/offline/AttendanceQueueRepository.js` | `beginDirectAttendanceReceipt`, `settleDirectAttendanceNoInsert`, `markRetry`, `markBlocked`, `markNeedsReview`, wake/review/recovery queries: atomic receipts, Retry-After, explicit verification reasons and legacy evidence compatibility. |
| `services/offline/AttendanceDatabase.js` | `QUEUE_STATUS.CANCELLED`: explicit known-refused receipt status; no schema migration or existing-row rewrite. |
| `services/offline/AttendanceSyncService.js` | `syncRow`, `verifyInterruptedUploads`: preflight before new upload markers; bounded fair GET-only review checks; existing FIFO and single-flight coordinator retained. |
| `services/offline/AttendanceVerification.js` | Verification diagnostics retain counts and matching evidence without dumping full normal history responses. |
| `components/AutoAttendanceBootstrap.jsx` | Legacy live source identity and exact-clock/timestamp forwarding; neutral saved-checkout notification. |
| `components/DurableAutoAttendanceBootstrap.jsx` | Neutral saved-checkout notification; existing lifecycle and native capture preserved. |
| `hooks/useAttendanceRecovery.js`, `components/settings/AttendanceRecoverySetting.jsx` | Availability notices, transport-aware recovery display and truthful earlier-record blocker copy. |
| `utils/attendanceRecovery.js`, `utils/attendanceHistory.js` | State descriptions, source-order-aware dependencies, and evidence-gated known-refused receipt labels. |

No backend code, native geofence source, new dependency, independent queue, or global polling system was added.

## Profile test data controls

Profile includes **Offline attendance API test** in development and `preview` builds. Each tap creates one complete historical IN/OUT pair for the authenticated tenant and employee:

- **Add chronological pair** appends a newer random pair and inserts IN before OUT.
- **Add non-chronological pair** prepends an older random pair and deliberately inserts OUT before IN. The normal worker still orders these historical test rows by timestamp, so it sends IN before OUT.

The first pair starts approximately seven days ago. Later pairs use random gaps of 30–300 seconds and durations of 60–900 seconds. Timestamps use the current tenant's cached server clock; future timestamps are refused. The two rows and reciprocal pairing links commit in one SQL statement, so workers cannot claim half a pair. Existing rows are never reset or rewritten.

These are **real queued attendance records** for use with a test account. Normal availability checks, policy gates, ordering blockers and background synchronization apply; no separate upload endpoint or worker is used. Profile's existing recovery controls show their outcomes. Adding fixtures does not change the live attendance session or fabricate native geofence receipts. The service also enforces the build restriction and current tenant/employee permissions when called outside the UI.

Implementation: `components/settings/AttendanceSyncTestSetting.jsx`, `hooks/useAttendanceSyncTest.js`, `services/offline/AttendanceSyncTestService.js`, and repository helpers `readSyncTestRange` / `enqueueSyncTestPair`. The `syncTest` payload metadata stays local and is excluded by the existing offline API payload builder.

## Executed validation

- Full Jest suite after the Profile test controls: **131 suites passed; 2,943 tests passed; 13 existing TODOs; zero failed assertions**. Command: `npm test -- --runInBand --watchman=false --silent --forceExit --json --outputFile=/private/tmp/claudion-profile-attendance-test-jest.json`. Jest remained open after reporting results without forced shutdown, so the full run used `--forceExit`; open-handle cleanup was not established by these checks.
- iOS and Android Metro production exports passed using `CI=1 node node_modules/expo/bin/cli export --platform ios --platform android --output-dir /private/tmp/claudion-profile-attendance-test-export --no-bytecode --max-workers 2`. These are JavaScript bundle checks, not native builds.
- `git diff --check` passed. No commit, push or deployment was performed.
- Mocked integration covers blocked-instance ENTER/EXIT, online ENTER followed by blocked EXIT, same-Wi-Fi recovery, multiple sessions across worker/database-handle restart, source/time preservation, cross-tenant clock isolation, and commit/lost-response verification without repost. Native capture/replay and policy/manual regressions remain covered by the existing mocked suites.
- During the mocked implementation validation, no application SQLite database or production attendance record was accessed or modified. The separately authorized live Simulator test below created one real IN/OUT pair. Live firewall testing, broader deployed endpoint side effects/compatibility, physical iPhone/Android background delivery, and native builds remain unexecuted.

## Authorized offline Simulator test — 2026-10-28

The user explicitly approved resetting the stale local session, creating and synchronizing **one real IN/OUT pair** on the current Rowad account, and temporarily disconnecting the Mac's Wi-Fi with automatic restoration. The test used the running iPhone 17 Simulator (iOS 26.5), employee `HR-EMP-00052`, and the existing AL-Rowad Clinic geofence (100 m, automatic mode 2). No Profile fixtures or fabricated native events were used.

SQLite was backed up before the reset. After Wi-Fi was disconnected, the stale session was closed locally through `reconcileSessionFromServer({ activeStartedAt: null })` as test setup, with its Redux mirror updated. This setup call did not read server status or submit a checkout. `simctl location` established an outside baseline approximately 1.1 km north of the location; the native `retryInitialPresence` method completed the previously unfinished outside-state observation. Interpolated simulated movement then crossed into and out of the real registered region.

| Check | Observed result |
| --- | --- |
| Actual disconnected transport | Wi-Fi off at 07:12:24 UTC; the app reported `type: none`, `isConnected: false`, `isInternetReachable: false`, and request admission false. |
| Native ENTER while offline | Event sequence 8 at 07:13:29.214 UTC; durable session became `CHECKED_IN` with origin `AUTO`; queue row **19**, IN at server wall-clock `2026-10-28 10:13:28`. |
| Native EXIT while offline | Event sequence 9 at 07:13:41.734 UTC; durable session became `CHECKED_OUT`, closed by `AUTO`; queue row **20**, OUT at `2026-10-28 10:13:41`. |
| Offline persistence and pairing | Both rows were `pending`, linked reciprocally; each native receipt was handled with `queued: true`. Both `onlineAttemptAt` and queue `uploadAttemptAt` were null; upload attempt counts were zero. |
| Reconnection without relaunch | Wi-Fi restored at 07:13:46 UTC, but NetInfo continued reporting `none` for the entire 120-second observation. Both rows stayed pending with zero upload attempts. A separate authenticated server-time GET returned HTTP 200 while NetInfo still said offline. This part of the test **did not pass**. |
| Automatic startup recovery | After app relaunch outside the region, NetInfo reported Wi-Fi. The existing worker sent row 19 before row 20, with one upload attempt each; both became `synced`, `acceptanceConfirmed: 1`. No manual Sync now or direct attendance submission was invoked. |
| Backend confirmation | Read-only `verifyQueuedAttendance` matched employee, original timestamp and direction to IN **EMP-CKIN-10-2026-000028** and OUT **EMP-CKIN-10-2026-000029**. |
| Preservation and final state | All columns of the previous 16 queue rows and 7 native ledger rows matched the backup. Final counts: 18 synchronized queue rows, 9 handled native events, zero unsynced rows, empty native pending journal, SQLite integrity `ok`; session checked out and Mac Wi-Fi restored. |

The installed NetInfo README documents missed iOS Simulator network-change notifications after host Wi-Fi reconnect (`node_modules/@react-native-community/netinfo/README.md`, “Issues with the iOS simulator”). Its installed native `RNCNetInfo.mm:getCurrentState` returns the watcher's cached state, and `RNCConnectionStateWatcher.m` updates that state on reachability callbacks. `NetworkListener.fetchShouldAttemptRequest` calls `NetInfo.fetch`; the worker correctly declined uploads while that state remained `none`. The independent successful GET establishes that actual server reachability and the Simulator's connectivity report diverged.

This proves native foreground offline capture, durable pairing, restart persistence and ordered live queue delivery on this Simulator. It does **not** establish seamless reconnection on a physical phone, background/locked/terminated delivery, Android behavior, or a production firewall outage. Validate transport restoration on a physical iPhone before attributing this Simulator notification failure to device behavior or changing the transport gate.

Local evidence and the before-test SQLite backup are in `/private/tmp/claudion-offline-boundary-koDmyq`; final app/queue evidence is in `/private/tmp/claudion-offline-boundary-pKT8wR`, and read-only server matches are in `/private/tmp/claudion-offline-boundary-p5nYIo`. Temporary test automation lived outside the repository. No runtime source code was changed for this live test; no commit, push or deployment was performed.


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

The reported incident is evidence for regression scenarios only: record **#1**, EXIT at **2026-10-27 09:59:46**, `needs_review`; record **#2**, ENTER at **2026-10-27 10:05:21**, held behind #1; employee **HR-EMP-00052**. This change does not reset their markers, remove them, resend them, reassign their tenant or alter production history. Any recovery must start with an authorized, read-only comparison against exact original server records.

Automated coverage uses synthetic tenants/credentials, mocked HTTP and an in-memory SQLite fixture. See `instanceAvailability`, automatic event/ambiguous-dispatch suites, queue/sync suites and `attendanceRecovery` tests for coverage of the availability gate, uncertainty boundary and UI. Do not treat those tests as evidence of live tenant compatibility or native-device background execution.

Recovery coverage includes light/dark rendering, preflight outage and unsupported-endpoint UI through the real mocked coordinator, persisted outage copy after remount, source-order dependency descriptions, historical manual recovery, and evidence-gated cancellation labels. The final delivery report records executed suite counts separately from live-device validation.

No dedicated authorized staging instance/employee was supplied. Live firewall simulator tests, backend compatibility checks and physical-device validation therefore remain **unexecuted**. Use a disposable authorized test employee for this checklist; preserve existing attendance and queues:

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

## Executed validation

- Full Jest suite: **130 suites passed; 2,929 tests passed; 13 existing TODOs; zero failed assertions**. Command: `npm test -- --runInBand --watchman=false --silent --forceExit --json --outputFile=/private/tmp/claudion-attendance-final-jest.json`. Jest remained open after reporting results without forced shutdown, so the final full run used `--forceExit`; open-handle cleanup was not established by these checks.
- iOS and Android Metro production exports passed using `CI=1 node node_modules/expo/bin/cli export --platform ios --platform android --output-dir /private/tmp/claudion-attendance-final-export --no-bytecode --max-workers 2`. These are JavaScript bundle checks, not native builds or device execution.
- `git diff --check` passed. No commit, push or deployment was performed.
- Mocked integration covers blocked-instance ENTER/EXIT, online ENTER followed by blocked EXIT, same-Wi-Fi recovery, multiple sessions across worker/database-handle restart, source/time preservation, cross-tenant clock isolation, and commit/lost-response verification without repost. Native capture/replay and policy/manual regressions remain covered by the existing mocked suites.
- Live firewall testing, deployed endpoint side effects/compatibility, physical iPhone/Android background delivery, and native builds remain unexecuted. No application SQLite database or production attendance record was accessed or modified during validation.


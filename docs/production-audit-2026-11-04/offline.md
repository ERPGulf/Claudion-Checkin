# Offline attendance and session audit — 4 November 2026

This audit inspected the current code and executable contracts. It did not submit attendance to a tenant, modify a device database, run a destructive migration, or establish physical-device delivery guarantees.

## Inspected architecture

| Ownership | Inspected files and behavior |
| --- | --- |
| Persistence | `AttendanceDatabase.js`, `AttendanceQueueRepository.js`: lazy shared SQLite handle, WAL, transactional additive migrations through **v6**, tenant-aware unique keys, owned atomic claims, leases, dispatch markers, dependency predicates, positive receipts, recovery reads. |
| Admission | `AttendanceQueueService.js`, `ManualAttendanceService.js`, `offlineAttendanceGate.js`: manual online-only, automatic policy/capability checks before admission and after awaits, location/cache gate, online direct receipts, preserved older manual/photo rows, queue retention during logout. |
| Upload/recovery | `AttendanceApi.js`, `AttendanceSyncService.js`, `AttendanceVerification.js`, `attendanceErrors.js`, `attendancePhotoUpload.js`: one punch per POST, strict per-owner ordering, recoverable unknown failures, positive-only duplicate/uncertain-write verification, scoped photo attachment. |
| Native ingress | `AutoAttendanceEventRepository.js`, `AutoAttendanceEventProcessor.js`: SQLite commit before native acknowledgement, deterministic source identity, owned claims, ordering, replay, exact history verification after uncertain dispatch, attendance session serialization. |
| Background orchestration | `BackgroundSyncManager.js`, `AndroidAttendanceBackgroundTask.js`, `NetworkListener.js`, `InstanceAvailabilityService.js`: active-app heartbeat, explicit wake triggers, bounded headless budget and health reads, transport versus tenant reachability, auth-generation guards. Native implementation was audited separately in [geofencing.md](geofencing.md). |
| Policy/support | `attendanceConfigCache.js`, `offlineCapability.js`, `attendanceQueueProvenance.js`, `AttendanceDiagnostics.js`, `attendanceDiagnostics.js`, `AttendanceSyncTestService.js`, `index.js`: scoped policy mirroring, transient versus unsupported capability, provenance, support-only reads, development/preview fixture gate, exported contracts. |
| Session/UI consumers | `utils/attendanceSessionState.js`, `hooks/useAttendanceAction.js`, `hooks/useAttendanceHistory.js`, `hooks/useOfflineStatus.js`, legacy `AutoAttendanceBootstrap.jsx`: lock spans submission, no recursive session reads inside execute, accepted versus server-confirmed state, current-owner reads/publication. |

The durable path is native journal → SQLite input receipt → session transition → existing automatic POST or accepted outbox row → owned one-row upload → explicit server receipt or read-only verification. SQLite acknowledges a receipt before native removes its copy. Session changes remain serialized. Logout clears cached authority without deleting punch/input evidence.

Schema v3 leaves old tenant provenance NULL; v4 adds verification evidence, v5 native source identity/input receipts, v6 upload ownership and durable dispatch markers. Neither audit phase changes the schema or migration version.

## Confirmed findings and implemented remediations

### OFF-01 — P1: Unknown connectivity became confirmed offline

Location: `services/offline/NetworkListener.js`, `normalizeState`, `refreshState`, native listener.

Both real adapters used `!!state.isConnected`, turning NetInfo's null/undefined unknown state into false, although the public predicate intentionally attempts a request unless transport is explicitly absent. During initialization/network handover this could skip tenant health/upload work and admit an automatic row as offline on a usable connection.

Fix: retain null uncertainty; only explicit false or `type: "none"` means missing transport. `isInternetReachable` remains diagnostic only. No endpoint, retry ladder or attendance policy changed. Risk: an uncertain network can now cost one real failed attempt, which is the existing documented tradeoff.

Verification: fresh fetch and native-event regression cases. All six tests in `networkListenerLifecycle.test.js` failed against the original adapters and passed after remediation.

### OFF-02 — P1: Old connectivity callbacks could replace newer state

Location: `services/offline/NetworkListener.js`, `refreshState`, `startNetworkListener`, `stopNetworkListener`.

A pending bridge fetch could overwrite a newer native event. Retained callbacks could also update global connectivity and notify reconnect listeners after stop/restart. This changed attendance decisions using obsolete network evidence and could wake synchronization after teardown.

Fix: fetch sequence, subscription generation and native-observation revision checks suppress superseded results and callbacks. Subscription teardown invalidates pending reads. Risk is limited to preferring the newer observation; no events/punches are discarded.

Verification: delayed fetch after native offline event, delayed fetch/callback after stop, and callback from a previous subscription after restart.

### OFF-03 — P1: Same-code employees from known foreign tenants shared UI reads

Location: `AttendanceQueueRepository.js` (`readScope`, `listUnresolved`, `listForHistory`, `countByStatus`); `AttendanceQueueService.js` scoped UI helpers; history/status/action hooks and legacy bootstrap consumer.

Reproduction: insert the same employee code/timestamp/action for tenants A and B. The tenant-aware unique key correctly retains both, but the original UI helpers filtered only the employee code, returning both rows and combined counts. History/sheet could disclose or merge company A's punches while company B was active; unrelated counts could hold B's local attendance reconciliation/presence guard.

Fix: optional captured owner scopes filter known foreign tenants consistently in status totals, blocked-class totals and oldest-pending queries. Reachable consumers pass the captured scope and reject stale auth/owner results before publishing. History/banner state is keyed by tenant/employee/auth generation; request sequence and mount guards suppress late reads. Repository support/tests retain their unscoped inspection contract.

NULL provenance remains unchanged, visible and a conservative dependency; it is never assigned the currently active tenant. Recovery still exposes it for review. This change does not establish ownership of historical NULL rows or authorize their upload.

Risk: scoped consumers can return no data while provisioning/auth changes, instead of presenting another owner's records. No persisted records, queue claims, uploads or server contracts were changed.

Verification: `attendanceQueueReadScope.test.js` exercises real SQLite with known A/B owners, NULL evidence, all derived count queries, scope change during read, and unscoped compatibility. `attendanceQueueUiScope.test.jsx` exercises captured owner arguments and late history/count/sheet results across a same-code tenant/auth change. Existing history refresh tests now provide synthetic provisioning.

### OFF-04 — P1: Attendance diagnostics exposed private data

Location: `attendanceDiagnostics.js`, `AttendanceQueueService.js`, `BackgroundSyncManager.js`, `attendanceConfigCache.js`, `attendancePhotoUpload.js`, `offlineCapability.js`, `NetworkListener.js`, action/history hooks.

Development uploads/verification logged raw payloads and response bodies containing employee/location records. Credential-key masking did not protect credentials embedded in free-form error/body text. Several production console calls also printed raw errors, employee identifiers or attachment references.

Fix: redact private structured fields and raw payload/body/error text even in development, preserve useful application-owned reason enums, remove employee/attachment identifiers from routine logs, and replace production error text with code/status metadata. Remove action-screen attendance/break-time debug prints. The support inspector remains an explicit read-only return value; it never automatically logs or transmits its result.

Risk: support logs contain less raw data; deliberate authorized support inspection and queue metadata remain available. Logging does not change admission or record settlement.

Verification: private synthetic employee/location/body/error values absent from development log output, safe status/count/reason metadata retained, and raw manual failure absent in release mode. The existing queue diagnostic test was updated to require redaction of its employee-valued `scope` field.

## Phase 2 local integrity remediation — 5 November 2026

### OFF-PAIR — confirmed local defect, fixed

The original legacy path committed a checkout INSERT, then awaited a parent lookup and two independent pair-link UPDATEs. A termination after the INSERT left a real checkout with no pair. Rejection also committed the parent refusal before performing the dependent UPDATE, so termination could leave a refused IN and a pending OUT. This was reproduced with deterministic SQLite fault injection; a production incident or physical-device crash was not claimed.

`AttendanceQueueRepository.enqueue` now admits a punch, its parent/session identity and both pair links in **one SQLite INSERT/UPSERT statement**. Materialized admission/parent snapshots prevent a duplicate from updating a parent toward a nonexistent child. Explicit new IDs respect both `MAX(id)` and `sqlite_sequence`, as the existing historical-pair helper already did. The conflict UPDATE changes only pair/session metadata; it never replaces a parent or overwrites its dispatch/acceptance evidence. An explicitly identified same-owner queued parent that is already rejected causes a dependent rejection in that same statement. Unattributed NULL rows remain separate from known tenants.

Parent identity is taken from the **current locked session**, not merely from the newest historical rejected IN. Newly committed IN sessions retain optional `serverConfirmed` and exact `queueRowId` metadata; this persists the distinction already present in the transition result. Durable and older-binary callbacks use `withSessionContext` to pass the current record without calling `readSession` inside the lock. A confirmed online/manual IN suppresses historical queue inference, so a later automatic OUT remains valid even when an unrelated rejected IN is retained from a previous day. Exact queue/source identity preserves the current-parent rejection guard. Unknown legacy identity plus a rejected historical candidate becomes review evidence with no guessed pair link, rather than a false terminal rejection or an unverified OUT submission. These optional local fields do not alter backend payloads or require a destructive storage migration.

`markRejected` now commits the root refusal and dependent outcomes in one owned UPDATE/RETURNING statement. A stale root claimant cannot modify either row. A dependent with prior dispatch evidence becomes `needs_review`, retains its original timestamp/payload/response/dispatch marker and cannot be POSTed again. A linked checkout additionally requires a same-owner, explicitly confirmed server check-in before it is claimable. This protects retained historical pairs whose old cascade was interrupted; it does not rewrite or guess missing historical ownership.

`pairWithOpenCheckin` remains a compatibility helper and updates both existing links atomically. Its failure rolls back both updates. `AttendanceQueueService` no longer performs a vulnerable post-admission pairing stage, and never returns `allowed: true` for a dependent refusal. It uses existing EN/AR refusal copy.

Regression risk: this changes admission/claim SQL and therefore receives broader queue, migration, session, provenance and ordering coverage. There is no schema reset, row deletion, new HTTP retry, backend contract change or reassignment of historical provenance. Historical ambiguous or incomplete records still require positive server evidence/correction; their uncertain status is not silently cleared.

### OFF-CLOCK — confirmed local defect, fixed

An owned lease created while the wall clock was far ahead could remain `syncing` for hours after rewind. Recovery previously checked only expiration against the new wall time. The unchanged supported maximum lease is **120 seconds**. Claim/direct-admission/renewal APIs now validate this bound; owner-guarded dispatch/settlement also require the stored lease to fall within it. A future expiry beyond `now + 120s` is invalid under this protocol and is conservatively recovered alongside ordinary expired/ownerless leases.

Only a provably owned **never-dispatched** claim returns to pending. Any dispatched/direct-online receipt or legacy ownerless uncertainty becomes `needs_review`, with its dispatch marker and original attendance fields retained. Verification scheduling is cleared so an old future `verificationCheckedAt` cannot strand the read-only check. The previous owner cannot renew, record a new dispatch or settle after a new owner takes over. Forward clock jumps use the same expiration path; a simulated reopen preserves dispatch uncertainty. Native input-receipt claim changes are documented in [geofencing.md](geofencing.md).

No boot identifier or monotonic timestamp was invented for existing rows. After an ordinary process restart/reboot with stable wall time, a live-looking old lease may wait for its existing remaining bound; a rewind that still leaves expiry within 120 seconds is also bounded rather than immediately identifiable. These limits affect recovery latency, not permission to resend an uncertain write. Physical reboot/network/clock testing remains part of `NATIVE-DEVICE`.

### OFF-STRAND — Phase 2 regression, found by the full suite and fixed (5 November, continuation)

Root cause: OFF-PAIR made `enqueue` pair a checkout with its local checkin and made a linked checkout claimable only after that checkin is server-confirmed. A checkin blocked as `endpoint-missing` is deliberately excluded from head-of-line dependencies, because only a backend deployment fixes it. Its paired checkout was left `pending` but permanently unclaimable, and a `pending` row **is** a dependency. One stranded checkin therefore held back every later row for that employee. `countOutstandingByScope` > 0 forced each new automatic punch onto the queue path, where `isOfflineSyncUnsupported()` refused it. Automatic attendance stopped for that employee until a deployment, whereas the baseline attempted the checkout, classified it `endpoint-missing` too, and continued. Reachable when IN and OUT are queued offline before the missing endpoint is discovered, or after sign-in clears the capability flag (`clearOfflineCapability`). Reproduced by the existing `androidAttendanceBackgroundWork` regression, the only failure in the first full-suite run of this session (162/163 suites).

Fix (two writers, so every reader stays consistent without reader changes):

- `markBlocked` with `endpoint-missing` also moves the same-owner paired checkout in `pending`/`blocked` with no dispatch evidence to `blocked`/`endpoint-missing`, with the same `blockedSince` and `nextAttemptAt`, in **one owned statement**. A stale claimant changes neither row. A dispatched checkout and every other failure class are left untouched.
- `enqueue` admits a checkout whose selected parent is already `blocked`/`endpoint-missing` in that same state, still paired.

The checkout still cannot be claimed before its checkin is confirmed. After a deployment, `wakeBlocked` wakes both, the checkin goes first, then the checkout. No schema, payload, retry or dispatch-evidence change.

Tests: the existing background-work regression now also asserts the paired checkout's admitted state, and keeps its original intent with an independent later row that must still wake the worker. New `attendanceQueueIntegrity` cases cover the cascade, `countOutstandingByScope` = 0, an accepted next-day direct receipt, wake ordering after deployment, auth/dispatched non-cascade and the stale-claimant guard. With both writer arms disabled, exactly the two positive regressions fail. Remaining tradeoff (unchanged from baseline): rows after an `endpoint-missing` pair may reach the server before that pair once the endpoint exists.

### WAL process-kill harness — reviewed and hardened (5 November, continuation)

`native-tests/sqlite/queue-process-crashes.cjs`, driven by `attendanceQueueProcessDurability.test.js`, replays the **actual** admission and rejection statements captured from the repository, plus the production schema, against disposable WAL files in child processes (Node 22.14 `node:sqlite`, SQLite 3.47.2). Review findings, all fixed in the harness only:

1. **Termination fidelity.** `process.exit` was replaced with `SIGKILL`, so no close, checkpoint, destructor or exit hook can run. A probe showed Node 22.14 does not close `DatabaseSync` on exit today; the change removes the dependency on that runtime detail.
2. **WAL recovery proof.** The committed cases now assert that the `-wal` file still holds frames before reopen, so a pass proves crash recovery rather than a checkpoint on clean close. Mutation check: closing the DB before the kill fails the test.
3. **Missing crash point.** The admission statement inserts the checkout first and links the parent last, so the original trigger fired before any parent link existed and "links rolled back" was vacuous. A second kill point at the parent pair-link UPDATE (the last write; SQLite fires UPDATE triggers on upsert `DO UPDATE`) proves full-statement rollback. Mutation check: a two-statement admission fails the test.

Six scenarios pass: kill after admission commit, kill at child insert, kill at parent link, kill after rejection commit, kill inside rejection, duplicate admission. Limits: host SQLite, not expo-sqlite on a handset (which bundles SQLite 3.49.1/3.50.3, above the 3.35 needed for `MATERIALIZED`, `RETURNING` and multi-clause upsert). Process kill is not power loss: the harness uses `synchronous=FULL`, while production sets only `journal_mode=WAL` and inherits expo-sqlite's default. Requires Node ≥ 22.13, as `engines`/Volta already declare.

### Phase 2 validation evidence

- Historical 4 November pre-fix result: `attendanceQueueIntegrity.test.js` **10 failed, 2 passed**; initial post-fix four-suite pass **163/163**. These were observed during the prior session; its temporary logs did not survive the environment reset.
- Fresh 5 November focused four-suite pass: **173 tests passed** before the final service refusal assertion.
- Fresh 5 November initial broader queue pass: **14 suites passed, 341 tests passed, 5 existing todo** (346 total), **3.692 seconds**.
- A subsequent independent review reproduced a parent-selection regression involving old rejected history and a later online-only manual IN. The locked-session parent-intent fix above includes an actual manual-IN→automatic-OUT workflow regression and a current-queued-parent rejection regression. The corrected focused run passed **7 suites, 304 tests, 8 existing todo** (312 total). A final broader rerun is recorded below when complete.
- The broader rerun was not recorded by the previous session. The 5 November continuation ran the **full suite**: first 162/163 suites (OFF-STRAND above), then after the fix **163/163 suites, 3,319 passed, 13 todo, exit 0**. See [validation](validation.md#phase-2--5-november-2026).
- The pre-existing `autoAttendanceOrderedQueue` fixture for a crash before pair links now explicitly removes links after current atomic admission, accurately modeling retained pre-fix data. Its no-upload/preservation assertions remain enabled.
- Changed-file ESLint and `git diff --check`: **zero errors**. Final application-wide/native results belong to the parent validation report.

The new cases cover commit-then-termination, SQLite `RAISE(ABORT)` rollback at admission/cascade/compatibility-repair boundaries, concurrent duplicate admission, reversed native wall clocks, explicit rejected parent admission, later confirmed manual IN with unrelated rejected history, unknown legacy-parent review, stale-owner cascade/settlement, dispatched dependent preservation, forward/rewound leases, reopen, future verification schedules, lease bounds and tenant/NULL isolation. SQLite is real WASM SQLite in isolated tests; a simulated reopen or injected exception is not evidence of OS process-kill behavior. The parent audit additionally runs an isolated real-disk WAL child-process harness against SQL captured from the actual repository; its final validation report distinguishes that host-SQLite evidence from Expo/physical-device behavior. No runtime speedup, battery improvement or exactly-once backend effect is claimed.

## Outstanding risks and boundaries

| ID / severity / status | Evidence, impact, next action, regression risk and verification |
| --- | --- |
| OFF-R1 / P1 / essential live contract unverified | Backend source/idempotency contract is unavailable. Dispatch markers plus positive-only history checks prevent blind automatic resends, but cannot establish exactly-once server effects or prove absence from paginated history (bounded to 25×20 rows). Verify employee mapping, timestamp precision, duplicate envelopes, history permissions and server insertion behavior on disposable staging. Never infer absence or automatically requeue uncertain writes. |
| OFF-R2 / P2 / local defect fixed in Phase 2; device validation external | Queue recovery and owner writes enforce the existing 120-second lease bound. Rewind/forward/reopen regressions retain dispatched rows as verification-only; old owners cannot renew/dispatch/settle. Closure of physical reboot/clock/response-loss behavior requires the signed-device `NATIVE-DEVICE` matrix; no blind resend is permitted. |
| OFF-R3 / P1 / local defect fixed in Phase 2; historical evidence may need review | Admission/pairing and rejection/cascade are each atomic SQLite statements, with fault-injection and duplicate/owner tests. Existing incomplete/ambiguous historical rows are retained without attribution and may still need positive server verification or an attendance correction. Device closure criterion: kill at capture/admission/upload boundaries, reopen and confirm original records/order with disposable staging. |
| OFF-R4 / P2 / deliberate retention tradeoff | `purgeSynced` is suspended and input receipts are retained. This preserves payroll evidence but allows disk growth over long use. Measure row/byte growth, define verified-receipt archival/retention with payroll ownership, then implement a separately reviewed lossless archive. No automatic deletion was added. |
| OFF-R5 / P2 / platform/battery measurement required | Foreground heartbeat is gated to active AppState, but Android's separate retry scheduler can wake before a blocked row's one-hour backoff expires. Native code inspection indicates up to a recurring 15-minute retry wake after its ladder settles. Measure headless runs and battery on physical devices before coordinating queue due times with native scheduling. No new timer/GPS polling was added. |
| OFF-R6 / P1 / local false assurance fixed in Phase 2; backend gate remains | Manual punches remain online-only, with one attempt. A failure after the write transport was invoked now shows app-owned "couldn't confirm" copy instead of "not marked" ([implementation](implementation.md)). A subsequent new-timestamp tap after a lost response can still create a second server record: this needs a backend idempotency/reconciliation contract and staging verification. Never add an automatic manual retry. Low residual: a local failure *before* `online()` (ordering-count read, scope change) also shows the "couldn't confirm" copy although nothing was sent. That is conservative, and it avoids surfacing the raw local error text that `classifyAttendanceError` would otherwise return. |

Existing safe behavior was retained: owned atomic claims, one-row uploads, FIFO/dependency ordering, generation checks after awaits, no ordinary 403 refresh, queued versus confirmed distinction, logout retention, known duplicate verification, suspended purge and unknown-error recovery. Unknown/missing GPS never independently establishes disabled access.

## Validation and performance evidence

- Pre-fix network regression: **1 suite failed, 6 tests failed**. Post-fix: all six pass.
- Initial focused admission/connectivity/config/lifecycle pass: **7 suites passed, 187 tests passed**.
- Initial broad offline/ingress/session/migration/worker pass: **19 suites passed, 451 tests passed, 5 todo** (456 total).
- Tenant UI/service focused pass: **3 suites passed, 14 tests passed**.
- Final combined offline/consumer pass: **32 suites passed, 713 tests passed, 13 todo** (726 total), 6.039 seconds. Application-wide results are recorded in the parent audit report; focused passes overlap and must not be added together.
- Changed-file ESLint: **0 errors**, four existing hook-dependency warnings in `useAttendanceAction`/`useAttendanceHistory`. `git diff --check` passed.
- There is no configured project TypeScript check. No native source, dependency, framework or release field changed in this subsystem work.

No cold-start, frame-time, memory, disk-growth, radio or battery benchmark was available for these changes. This report claims correctness/privacy improvements demonstrated by regression behavior; it claims no measured runtime speedup. Simulator/mock results cannot establish background delivery or battery behavior on physical devices.

# Historical attendance recovery audit

Audit baseline: `d6e1ca8`, 2026-09-08. This document records the **pre-patch** behavior. Commit dates below are not evidence of device deployment dates. No affected device database or tenant backend source/records were available.

## Executive summary

Confirmed mechanisms, not a confirmed customer-specific root cause:

1. Historical synced/duplicate and resolved rows are excluded from Profile recovery.
2. Duplicate wording is accepted without checking the equivalent server punch.
3. A nonempty inserted array wins even when malformed or contradicted by failures.
4. Old logout/expiry cleanup deleted the entire queue.
5. Synced rows, including false successes, are deleted after seven days from their last update.
6. Migrated rows retain their data but have unknown tenant provenance and cannot safely drain.

The customer dates/worker codes alone cannot establish whether a punch was captured, queued, transmitted, deleted, or filed on another tenant. Distinguish Employee Checkin logs from downstream Attendance documents and payroll reports when checking the server.

## Exact current queue lifecycle

- Capture: `utils/attendanceSessionState.js:performSessionTransition` serializes manual/geofence changes across submission. `hooks/useAttendanceAction.js`, `screens/AttendanceCamera.jsx`, and `components/AutoAttendanceBootstrap.jsx` supply execution callbacks. Queued acceptance changes the session but is distinct from server confirmation.
- `services/offline/AttendanceQueueService.js:submitAttendance` branches manual attendance to `submitOnlineOnly`: no queue write even on failure. Automatic attendance attempts the online endpoint unless offline or ordered behind older work. Policy/capability/cache/location refusals can prevent insertion. Successful online punches also have no queue row.
- `services/api/attendance.service.js:userCheckIn/autoCheckInOut` require a returned `message.name`; HTTP success alone is insufficient. They call `add_log_based_on_employee_field`. The original online payload/time is not persisted before sending. Automatic fallback constructs a queue timestamp later; it is not guaranteed identical to the initial request after an uncertain online commit.
- `AttendanceQueueService.queueAttendance` timestamps using `utils/serverClock.js:formatOfflineTimestamp`, inserts via `AttendanceQueueRepository.enqueue`, then tries pairing. Pairing errors do not undo the insert.
- `AttendanceDatabase.js:getDatabase/migrate` opens `claudion-attendance.db` in WAL mode. Table `attendance_queue` has an autoincrement integer ID, JSON payload/response and no status CHECK constraint. Unique index: `(IFNULL(tenantKey, ''), employeeId, timestamp, action)`. `enqueue` uses `ON CONFLICT DO NOTHING`; an existing row in any status wins. No collision audit is saved.
- `AttendanceQueueRepository.claimNextPending` atomically claims the oldest due scoped pending row. Older pending/syncing and blocked rows other than endpoint-missing block successors. Unknown-tenant older rows can hold up known-tenant work. An unresolved cross-scope pair also blocks claiming. `hasWorkDue` is less strict and can report work when claims are impossible.
- `AttendanceSyncService.syncPendingAttendance` checks employee/tenant/account/auth generation, coalesces runs, releases stuck claims once per scope/session, wakes blocked rows, repairs implausibly distant pending deadlines, checks transport, then processes at most 50 rows. Halts on transient failure, blocked outcome or scope change. Token rotation is allowed; identity changes cancel later requests.
- `AttendanceApi.pushCheckin/buildCheckinRecord` sends one `{logs: [record]}` JSON request to `employee_app.attendance_api.add_offline_employee_checkins`, timeout 20 seconds. Fields: employee docname or code, original queued timestamp, device_id, IN/OUT, over_time and optional location. No parent server ID or idempotency key is sent.
- `AttendanceApi.interpretPushResponse` accepts message/data/top-level envelopes. Any nonempty inserted array becomes success; otherwise only the first failed error is interpreted. Duplicate regexes become success. Known validation becomes rejected; unknown answers become blocked. `AttendanceSyncService.syncRow` also accepts thrown duplicate messages as success.
- `markSynced` saves response, ID/duplicate flags, clears failure diagnostics and changes updatedAt. Photo upload happens afterwards and failure does not undo attendance; its result is not durably tracked. `purgeSynced` then deletes synced rows with updatedAt older than seven days, across all employees/tenants, without server verification.
- `BackgroundSyncManager.startBackgroundSync` triggers on launch, foreground (debounced), reconnect, token refresh, queued/successful online punch (three-second kick), foreground interval (one minute). `syncNow` wakes pending/blocked backoff explicitly. No independent OS background drain exists. `NetworkListener.isStateOnline` checks transport, not isInternetReachable. `OfflineAttendanceBootstrap` keeps existing-data draining active when new offline queueing is disabled.

## All statuses and whether the UI shows them

Profile recovery always requires the current employee and either current or NULL tenant. Known other tenants/employees are excluded.

| Status | Entry | Retry/server effect | Profile recovery before patch | Deletion/invisibility |
| --- | --- | --- | --- | --- |
| pending | enqueue, markRetry, wakeBlocked, released claim | due, correctly scoped rows can upload; FIFO applies | included | no age deletion; scope filters and banner suppression can hide it |
| syncing | atomic claim | request may already have committed; released on restart | included | no age deletion; NULL-tenant claim cannot be released by scoped production drain |
| blocked | recoverable server error, unknown error, transient cap | slow retries forever, once woken and correctly scoped | included; counts as recoverable only on known current tenant | no age deletion; banner may be suppressed |
| rejected | validation message or paired rejection | never auto-retried; correction possible | included but not pending count | retained; correction can make it resolved |
| resolved | correction submitted, paired rejected rows carried along | no queue retry; correction may still need server approval | excluded | retained, hidden |
| synced | inserted array or duplicate text | never retried | only current tenant successes since current mounted user sync attempt | hidden otherwise; seven-day updatedAt purge |
| failed | v1 terminal errors or old retry cap | v1 migration converts to blocked; a failed row in an already-upgraded DB is not claimed | excluded if not migrated | retained but hidden |
| duplicate | normally a boolean on synced, not a status | no independent writer | standalone status excluded | unknown statuses retained but hidden |
| cancelled/invalid/other | no writers found, unrestricted TEXT schema permits values | no claim/wake path | excluded | retained but hidden |

Sources: `AttendanceDatabase.QUEUE_STATUS/UNRESOLVED_STATUSES/AWAITING_SERVER_STATUSES`; `AttendanceQueueRepository.listUnresolved/listForHistory/countByStatus/countRecoveryByScope/listRecoveryRows`; `hooks/useAttendanceRecovery.js`; `components/settings/AttendanceRecoverySetting.jsx`.

Additional views: `listUnresolved` limits 100; `listForHistory` limits 200; `listAll` diagnostics limits 500. `utils/attendanceHistory.js:mergeQueuedRecords` hides synced/duplicate local rows older than the loaded server window, and hides any local row matching server time/type without employee/tenant in the match key. No DB mutation results. `hooks/useOfflineStatus.js` suppresses blocked/stale-pending notices when capability is unavailable or alerts disabled. Some queue-read failures in older views retain stale/empty results; Profile recovery explicitly shows read errors.

## How this symptom can happen

### Confirmed paths in code

- Hidden completed/legacy status: see filters above.
- False duplicate: `attendanceErrors.DUPLICATE_PATTERNS/isDuplicateMessage` matches same-timestamp text, duplicate entry/checkin/check-in/log, or Employee Checkin already-exists text. It does not prove employee, time, type, document or tenant. Matching is substring-based and can misclassify contextual/negated diagnostic text. Bare "duplicate" and arbitrary "already exists" are not universally matched. Structured and thrown branches both call markSynced without an existence read.
- Malformed success: `interpretPushResponse` accepts `[null]`, multiple inserted entries, inserted plus failed, and contradictory counts/status. Empty inserted alone, HTTP 200 alone and empty bodies do **not** produce success. v1 parser used the same permissive inserted/duplicate handling, but defaulted other answers to terminal failure.
- Old deletion: `git show a5cd249 -- services/offline/AttendanceQueueService.js` proves removal of clearAttendanceQueue from logout on 2026-09-01. Earlier `clearOfflineAttendance` deleted all statuses. `App.js:registerSessionCleanupHandler`, `apiClient.expireSession`, and `screens/Profile.jsx` connect expiry/manual logout to cleanup. Current cleanup preserves rows. The database helper's logout comment is stale.
- Cleanup: `AttendanceQueueRepository.purgeSynced` is status/updatedAt-only. It can delete an uncertain row after false duplicate/insert success. Not based on attendance date or sibling status.
- Correction: `hooks/useAttendanceRequest.js` calls `resolveWithCorrection` after request creation; `markResolved` changes rejected rows and rejected pair, not proof of Attendance creation/approval. Pair resolution does not scope-check the paired ID; ordinary pairing is scope-restricted, but legacy/corrupt relationships are a risk.
- No durable queue row: current manual failure, policy refusal, crash before insert, online success (including a misleading name response), or native event never processed. `GeofenceStore.swift/.kt` retains only the last event; `geofenceEventLog.evaluatePendingEvent` expires replay after 24 hours; `AutoAttendanceBootstrap.replayPendingEvent` also skips stale/illegal session transitions. Redux/AsyncStorage session state is a current-session authority, not an archive from which whole historical days can be reconstructed.

### Likely, conditional inference

If these were previously visible captured queue rows and the currently reported count is genuinely zero, a hidden terminal/success state or deletion fits better than a backoff delay alone. Older unknown-tenant rows should be visible as company verification issues if their status is unresolved.

### Possible; requires device/backend evidence

- Old unscoped drain uploaded under another account/site; tenant provenance did not exist before v3. Employee scope alone was not tenant isolation.
- Customer shorthand codes do not equal stored employeeId; leading zeros/prefixes matter.
- Checkin logs exist but Attendance generation/report filters, employee mapping, timezone or date expectations differ.
- Reinstall, OS/app data clear, restored backup, wrong device, storage corruption/read failure.

### Ruled out as sole current-code causes

No migration row deletion, pending-age deletion, queue size cap, sibling-success deletion, or rejection-age purge exists. Null sessionId/pairedAttendanceId/serverCheckinId does not hide a row or make IN/OUT payload construction impossible. Current retry exhaustion retains blocked rows. Scheduling/NetInfo alone cannot change an existing visible pending row to a hidden status.

## What likely happened to these historical records

Relevant commits: e815961 (Aug 7 initial v1, terminal failed and logout deletion); 6f5a087 (Aug 7 v2 failure model); a5cd249 (Sep 1 preserve queue on logout); fd84095 (Sep 3 drain improvements); 213e995 (Sep 6 manual online-only); 82d4218 (Sep 6 v3 tenant provenance); d6e1ca8 (Sep 6 recovery/photo).

Every surviving pre-v3 row migrates to NULL tenant. v1 failed becomes blocked/unknown with blockedSince=old updatedAt; timestamps/payload/retry fields remain; pairing columns stay NULL, no invented relationship. v2 to v3 only adds NULL tenant and replaces/adds indexes. Steps are transactional, user_version advances on commit. Open failures retry and do not reset/drop the database; initialization failure can make data inaccessible, not prove it absent. Downgrade writers can introduce statuses a one-time migration will not revisit.

On Sep 8 with a correct clock, the seven-day purge might explain early Sep 1 records depending on sync updatedAt. It cannot alone explain Sep 2–5 records. No installed-version/deployment history was supplied, so no worker-specific attribution is justified.

## Are the records recoverable?

- Still in DB: employeeId, optional employeeDocname, attendanceType, action, timestamp, latitude/longitude/accuracy, address, deviceId, JSON payload (location/distance/radius/over_time/photoUri), id, optional tenant, sessionId/pairedAttendanceId, serverCheckinId/serverResponse, duplicate/message, error/failureClass, retryCount/nextAttemptAt/blockedSince, createdAt/updatedAt, resolutionDocname/resolvedAt are available. Photo files may no longer exist.
- No timezone, durable client UUID, original device event epoch, original online request, immutable attempt history, exact total attempts or dedicated last-attempt time existed at baseline. deviceId is generally MobileAPP, not a device-unique key. Timestamp precision is seconds; clock offset is global and not attached to each row. Original timezone/tenant cannot be fabricated.
- Deleted: no tombstone/archive/backup recovery in app. A retained device backup, server logs/backups or other authoritative captured payload is necessary. WAL is not a reliable undelete mechanism. No attendance may be fabricated from worker/date alone.
- Falsely synced/duplicate: preserve original evidence; look for exact positive server equivalence first.
- Incomplete pair: original IN/OUT can be represented without parent ID; no pairing reconstruction is required just to inspect/verify. Rejection cascades can retain a valid sibling without ever sending it. Two separate pairing UPDATEs are not transactional; crashes can leave asymmetric links. Do not automatically repair ambiguous pairs.

## Recommended recovery architecture

Extend existing Profile recovery for all retained statuses under the same current employee/current-or-unknown tenant scope. Show worker, original timestamp/action, local outcome, understandable reason, local reference, transient retries and newly recorded attempt times. Keep terminal rows accessible with zero normal pending work. Unknown statuses and old completions need review; resolved means correction submitted.

Use `get_attendance_details` (existing paginated history endpoint from `attendance.service.getUserAttendance`) only for positive verification: known tenant/account, exact employee identity, timestamp including nonzero fractional seconds, IN/OUT and nonempty document name. Read raw server data, not merged history. Bounded pagination/no match, denied access, malformed result and ambiguous equivalence never prove absence. Keep them in review. Do not reinterpret a server timezone.

Offer per-row **Check server record** on retained terminal/uncertain known-tenant rows. Positive proof can reconcile; otherwise retain for support. Existing pending/blocked retry uses existing scoped atomic FIFO drain. No resend-all, no terminal row reset, no client assignment of NULL tenant. Server metadata or authorized mapping outside this patch is needed for legacy tenant recovery.

## Minimal safe patch

All-status recovery visibility; explicit needs_review state for new ambiguous responses/unverified duplicates; strict inserted response checks; positive duplicate verification; per-record read-only reconciliation; stop automatic age purge; additive evidence/attempt fields; parameterized offline DB diagnostics. Keep existing payload construction/manual online-only rules and one-row upload. Historical terminal rows are not automatically requeued.

## Longer-term robust fix

Backend authoritative exact existence/absence and identity mapping; stable UUID persisted before first request and accepted idempotently by both endpoints; server transaction/unique constraint protecting concurrent retries, with result correlation and equivalent duplicate fields; immutable capture/attempt evidence and explicit safe retention/archive; correction outcome reconciliation; native event journal. Backend source and production response samples must validate these contracts first.

## Files that would need changes

AttendanceDatabase, AttendanceQueueRepository, AttendanceApi, AttendanceSyncService; new verification and diagnostic helpers; useAttendanceRecovery, AttendanceRecoverySetting, recovery presentation/history status helpers; tests and this runbook. No native, release/runtime or provisioning changes planned.

## Tests required

| Requested case | Required evidence |
| --- | --- |
| 1 Legacy pending upgrade | original payload/time/ID survives v1/v2/v3 opens |
| 2 Legacy failed discoverable | v1 migrates blocked; already-upgraded failed remains visible |
| 3 Blocked recovery UI | counts/details and normal retry |
| 4 Hidden terminal uncertainty | all-status list after remount; no automatic resend |
| 5 Confirmed acceptance | valid single inserted ID accepted; empty/malformed/contradictory responses retained |
| 6 Equivalent duplicates | exact positive employee/time/type proof; mismatch never success |
| 7 Timeout after commit | local row survives; same queued timestamp retries |
| 8 Lost response retry | simulated server dedupe plus positive existence read |
| 9 Legacy IN no pair | retained/verifiable; normal scoped pending IN still sends |
| 10 Legacy OUT no parent ID | retained/verifiable; original OUT payload sends |
| 11 Restart | durable rows/evidence retained; abandoned claims recovered |
| 12 Logout | all unsynced/review records retained |
| 13 Cleanup | no uncertain record deleted, including old synced duplicates |
| 14 Counts | actionable/review counts agree with scoped DB list |
| 15 Recovery no duplicates | verification uses GET only; no absence-to-resend path; account race guarded |
| 16 Normal sync | existing attendance/offline/auth/session/UI suites |

Client tests cannot prove backend transactions/deduplication or OS process-death/upgrade behavior. Verify on appropriate production-compatible iOS/Android builds before release.

## Risks / duplicate-attendance protections

No observed response proves downstream payroll Attendance. A valid inserted acknowledgment is server acceptance, not an independent reread. Duplicate regexes identify a claim only. No missing-history result authorizes resend. Tenant NULL is unknown, never the current site by assumption. Keep original timestamps/payload and pair metadata. Do not purge/reset production DB or run broad UPDATE-to-pending SQL. Retaining completed evidence increases storage; future cleanup requires an explicit archive/retention design.

## Device diagnostic procedure

Acquire a consistent copy using platform-approved device support tooling or SQLite backup; preserve the DB plus relevant WAL/SHM if copying a live database. Keep an untouched copy and hash. Do not log in/out or repeatedly sync an old build before preserving evidence. Record installed native/runtime/OTA identifiers, employee provisioning history and clock/timezone. No such production access was available during this audit.

Diagnostic input (not application constants):

```json
[
  {"date":"2026-09-01","employees":["0143","0251","0222"]},
  {"date":"2026-09-02","employees":["0202","0246","0256","0279"]},
  {"date":"2026-09-03","employees":["0246"]},
  {"date":"2026-09-04","employees":["0246"]},
  {"date":"2026-09-05","employees":["0251","0278"]}
]
```

Run the diagnostic helper with these string IDs (preserve leading zeros), the inspected device's current employee/tenant scope and a frozen inspection time. Query every status and tenant for each input; do not use listAll's 500-row cap. Report unmatched input explicitly. If no exact match, inspect distinct stored employeeId/employeeDocname values and adjacent dates under support authorization; do not assume numeric suffix equivalence. For each hit retain raw payload/response separately as restricted evidence, and report current UI eligibility versus the baseline filter, status retry eligibility versus immediate FIFO claimability. Error text is support data and may include sensitive backend content; it must not be automatically transmitted.

No match means not found in this snapshot, not proof of deletion. The exhaustive app deletion paths found are old logout cleanup, automatic synced purge and explicit purgeAttendanceQueue/clearAttendanceQueue (no current production callers for explicit purge). There are no per-row deletion tombstones to distinguish them after the fact.

## Implementation addendum

Implemented after presenting the audit; no production deployment or attendance replay was performed.

- `AttendanceDatabase.migrate`: schema **4**, seven additive fields: acceptanceConfirmed, verifiedAt, verificationEvidence, verificationCheckedAt, verificationIssue, lastAttemptAt, attemptCount. Defaults assert no historical acceptance/verification and no historical attempt count. Existing statuses, provenance, IDs, payloads, timestamps, retry state and relationships are not rewritten by v4. Failed migration steps roll back before retry; a regression test injects failure after ALTER statements and confirms the original rows survive.
- `AttendanceApi.interpretPushResponse`: one nonblank string inserted ID, no failed rows, no contradictory counts/error/exception. Malformed or contradictory acknowledgments become needs_review. Existing explicit validation/configuration/transport handling remains. Empty/unknown non-success bodies still use the preexisting blocked fallback; no phantom success is inferred.
- `AttendanceSyncService.settleDuplicate`: regex wording is now only a duplicate **claim**. A separate exact server-history match is required before duplicate success. Unverified claims become needs_review and stop the drain. Their original response and duplicate claim remain saved. New valid inserted acknowledgments set acceptanceConfirmed; independent verification is a separate field.
- `AttendanceQueueRepository`: review rows are unresolved and block newer uploads to preserve ordering. They also count toward session guards that must respect an uncertain server outcome. Neither blocked waking nor pending retry requeues review rows. `purgeSynced` is deliberately a no-op for **all** completed rows, including confirmed ones, until a separate archive policy is reviewed. There is no completed-data migration/purge.
- `AttendanceVerification.verifyQueuedAttendance`: raw GET to existing get_attendance_details, pages of 20, at most 25 pages (500 visible records). Requires explicit matching employee, wall-clock time and IN/OUT plus a nonblank server docname. Zero fractional seconds may be normalized; nonzero fractions, changed times/types and timezone offsets are not guessed. Two exact matches on a returned page require review. A bounded/nonexhaustive history read can prove presence but cannot prove absence. If the deployed endpoint omits employee/name/time/log_type, verification remains inconclusive until its contract is verified or extended.
- `AttendanceVerification.reconcileAttendanceRow`: user-selected terminal/uncertain rows only, current employee and known tenant, session checks before/after network awaits and an optimistic conditional DB update. **GET only; no resend or requeue path.** Positive proof stores an evidence subset and originalStatus, marks only the selected row synced, and leaves its original payload, response/error, timestamp and pairing fields intact. Negative reads persist a review issue without claiming absence or removing earlier evidence. They remain visible across restarts, even for a previously acknowledged/verified row.
- `useAttendanceRecovery`/`AttendanceRecoverySetting`: the existing Profile sheet now lists every retained status for the current employee/current-or-unknown company, even with zero pending work. Review and company issues have separate counts. Record details include worker/date/time/action, original local status, explanation, reference, transient retries, attempts recorded since this upgrade and last recorded queue attempt. Raw backend errors are not shown. Known-terminal rows offer Check server record. Pending/blocked retain the existing Sync now action. Unknown-company rows cannot upload or be reassigned from the UI.
- `AttendanceDiagnostics.inspectAttendanceQueue`: read-only, parameterized diagnostic input, all matching statuses/tenants without the old 500-row local query cap, explicit unmatched worker/date inputs, pre-patch UI inclusion versus new recovery inclusion, normal pending eligibility versus immediate FIFO claimability. Claimability uses the same SQL dependency predicate as the real claim. Output also includes original request material and server errors for authorized support inspection; it is not logged or transmitted automatically.

Support invocation in an authenticated device debugging/support context:

```js
import { inspectAttendanceQueue } from './services/offline/AttendanceDiagnostics';
import { captureAttendanceQueueScope } from './services/offline/attendanceQueueProvenance';

// diagnosticTargets is the report's JSON input above, supplied for this incident.
// currentEmployeeId must be the inspected device's authenticated employee.
const scope = await captureAttendanceQueueScope(currentEmployeeId);
const diagnosticReport = await inspectAttendanceQueue({ targets: diagnosticTargets, scope });
// Inspect locally. No automatic upload, database reset, or resend is involved.
```

This JS helper uses the normal database open/migration path. Preserve the original device snapshot **before** running it; for a pre-upgrade forensic snapshot use read-only SQLite inspection, not an app launch that can drain/migrate. SQL to find originals on that snapshot (bind parameters per worker/date; works on v1 too):

```sql
SELECT * FROM attendance_queue
WHERE employeeId = :employee_id AND substr(timestamp, 1, 10) = :attendance_date
ORDER BY timestamp, id;
```

The repository does not include a production support transport/device DB extractor. Running this on the affected device or a safely acquired copy remains an operational step, not work already performed.

### Changed files

| Area | Files |
| --- | --- |
| Persistence/drain | services/offline/AttendanceDatabase.js, AttendanceQueueRepository.js, AttendanceApi.js, AttendanceSyncService.js |
| New recovery services | services/offline/AttendanceVerification.js, services/offline/AttendanceDiagnostics.js |
| Existing UI/hooks | components/settings/AttendanceRecoverySetting.jsx, hooks/useAttendanceRecovery.js, hooks/useOfflineStatus.js |
| Presentation | utils/attendanceRecovery.js, utils/attendanceHistory.js, utils/offlineStatus.js |
| Tests | __tests__/attendanceOfflineApi.test.js, attendanceQueueMigration.test.js, attendanceQueueRepository.test.js, attendanceRecovery.test.jsx, attendanceSyncService.test.js, new attendanceDiagnostics.test.js |
| Documentation | CLAUDE.md, docs/attendance-sync-forensic-audit.md |

### Validation and remaining limits

Final complete Jest run with `--runInBand --watchman=false --forceExit`: **71 suites, 1,638 tests passed**, exit code 0. This includes the final independent-review changes, banner-count regression, light/dark recovery controls, all requested client regression cases and raw diagnostic evidence preservation. `git diff --check` passes.

Diagnostic tests preserve unparseable raw payload/response text; hydrated fallback objects must never be mistaken for the original forensic evidence. The new attempt counter measures queue claims since v4, including preflight attempts cancelled before HTTP, not the unknown total lifetime requests.

Focused recovery/banner/status and diagnostics/repository runs also passed. No failed assertions remain.

An earlier full run with `--detectOpenHandles` identified redux-persist timer handles from tests importing `redux/Store.js:36` (including apiClient and offline gate tests), plus React act warnings. These are test-process cleanup diagnostics, not failed assertions; that still-running Jest process was interrupted only after its complete summary/handle report. The final run used `--forceExit` for these known timers. Pure parser/new diagnostics tests stub the unrelated Redux store. No native/device builds were run, no visual device screenshots were captured, and no live tenant was queried. Recovery controls are exercised with both actual light/dark palettes; the full suite covers existing modern/legacy history consumers.

Backend confirmation is still required for Employee Checkin versus Attendance/report discrepancies, exact history field shapes/permissions, tenant attribution of pre-v3 rows, server-side unique constraints and safe absence/idempotency contracts. A simulated commit-then-timeout test proves the client preserves/reuses the queued request and verifies a duplicate response; it cannot prove the real backend deduplicates atomically. The online-first fallback's potentially different timestamp is documented above and is not changed by this patch.

Final independent safety review tightened employee equivalence: the returned employee must equal the effective uploaded identifier (`employeeDocname || employeeId`); an alternate code/docname representation is not assumed to be an alias. Ambiguous responses retain the entire original envelope, including outer exceptions. Unknown-company UI copy makes no claim that historical uploads never occurred. No further migration/data-loss/cross-tenant recovery blockers were found in that review.

No client-only recovery can restore deleted originals or safely resend a known-missing historical record under an unproven backend contract. Retention grows local storage, and a rollback to an older OTA can restore the old purge/UI behavior; release validation must include the actual native/runtime/OTA combination and an affected-device snapshot. No release fields or native code were changed.

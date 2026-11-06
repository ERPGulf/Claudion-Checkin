# Implemented changes and review

All work is uncommitted. The initial tree was clean; no unrelated changes were overwritten. No dependency, schema migration, endpoint payload, automatic-attendance eligibility rule or native attendance source changed.

**Phase boundary:** the statement above describes Phase 1 (4 November). Phase 2 continues on 5 November with the same uncommitted work preserved. Compatible JavaScript/transitive dependency updates are now applied; schema and native attendance production sources remain unchanged. The current validation/readiness reports supersede Phase 1 counts.

## Startup, update lifecycle and small presentation fixes

**START-01 / OTA-01:** `App.js` held every bootstrap behind update-server availability and duplicated banner work. Removed startup OTA check/download/reload; the existing banner now checks/downloads only while active, coalesces overlapping events, rejects completion after teardown/background and waits for another foreground event following failure. Splash promises have local rejection handlers. App boot no longer depends on update-service response and an attendance wake does not trigger JS OTA work. Downloaded updates retain the existing explicit apply action and native launch policy. Risk: update application timing changes; release-device/native OTA races still need validation. Tests: new `appStartup` and seven `updateBannerLifecycle` cases plus existing `otaUpdate` contracts.

The update apply control also exposes button/busy/disabled accessibility state and a minimum 44-point target. Existing label, palette and action remain.

**UI-LOCALE:** `screens/Chat.jsx` subscribed to locale but did not rerun its header effect when language changed. The effect now depends on the locale-bound translation callback. The new retained-tab EN→AR regression failed before the fix and passes afterward. No navigation route or placeholder feature changed.

**OBS-DEBUG:** `firebase.json` now disables debug Crashlytics collection, matching the intended documented policy while retaining release collection and handler chaining. The installed native code and built iOS plist confirm the flag is false. A native configuration test protects it. New builds are required; an existing binary cannot receive that configuration change over OTA.

**Final diagnostic review:** the remaining direct-attendance catch emitted a raw refresh error/body after a successful punch. It now uses the existing bounded helper. A regression fails a post-confirmation totals refresh, verifies private fields do not reach logs and preserves durable/Redux IN. `services/api/featureSettings.service.js` also now emits only recognized-shape/status metadata in development, with two success/error privacy regressions. All three failed against the prior diagnostics; endpoint/result/session contracts remain unchanged. Final affected pass: two suites/106 tests.

## Authentication, push and diagnostics

[Authentication/network report](auth-network-security.md) records AUTH-01, AUTH-02, PUSH-01 and PUSH-02, including the changed hook/legacy screen/FCM service, root causes, safe generation ownership, successful-topic cache updates and delayed-promise regression cases. Neither login mode's payload nor refresh ownership changed.

[Geofence/UI report](geofencing.md) records GEO-01/GEO-02 and UI-PRIV extensions: private event/topic/error logs removed across presentation variants; eligibility withdrawal/unmount cancels subsequent permission prompts. Shared permission sequencing and all attendance policy semantics remain. Existing `describeHttpFailure` is reused; no new logging infrastructure or native dependency.

## Offline ownership and connectivity

[Offline report](offline.md) records OFF-01 through OFF-04: retain unknown connectivity, reject stale fetch/listener results, filter all UI queue read/count queries by captured ownership, reject old-owner UI publication, and redact private attendance diagnostics. Real-SQL tests retain both known tenants' rows and NULL-provenance evidence while selecting only current/unknown evidence for conservative UI. No row is reclassified, deleted, uploaded or assigned a tenant by the new read path.

New regression suites are `networkListenerLifecycle`, `attendanceQueueReadScope` and `attendanceQueueUiScope`; existing diagnostic/history tests now assert bounded/redacted values and supply synthetic provisioning. Repository unscoped administrative inspection remains backward compatible; reachable presentation/reconciliation consumers use explicit scope.

## Test resource ownership

`queryClientSession.test.js` now disposes its detached canceled Query after cancellation settles. `loanApplicationUi.test.jsx` and `requestHistory.test.jsx` now track/dispose their test-owned QueryClients after unmount/cancellation, including mutation GC timers. Allocation tracing reproduced a five-minute detached timer plus 42 retained client timers before cleanup and no retained timers in the affected focused runs afterward. No force-exit flag, disabled test, production retry/timer change or global test-mocking relaxation was used.

## Review

An independent agent applied the read-only `review-agent` workflow to startup/OTA, Firebase config, QR login and FCM changes: **no findings**, with seven related suites/107 tests passing. Another independent review examined tenant SQL filters, count aggregation, consumers, auth/identity publication guards and NULL-provenance retention: **no findings**, both new scope suites/nine tests passing. The primary agent inspected the remaining complete diff and associated contracts. Review/test success does not establish physical-device behavior or backend compatibility.

Documentation updates are scoped to the new audit directory, current offline architecture ownership/schema notes, permission cancellation behavior and regenerated localization coverage. The advisory/source inventories are evidence files, not new application runtime features.

## Phase 2 — truthful manual outcomes and bounded uploads

**OFF-MANUAL local defect:** `userCheckIn` previously returned the same failure shape when its clock/policy preparation failed and when its POST may have committed but lost the response. `describeManualFailure` then said the attendance was not marked. The service now records whether the write transport was invoked; missing record identifiers, unknown errors and transport failures after a possible write produce an app-owned unconfirmed-outcome message. Pre-write transport failures retain the not-submitted message and known refusals retain their established feedback. Endpoint/payload/sole-attempt behavior is unchanged; no manual outbox or retry was introduced.

Files: `services/api/attendance.service.js`, the manual-only section of `AttendanceQueueService.js`, existing manual/API queue tests and EN/AR attendance resources. Six deterministic checks failed before the change and passed afterward. They model a committed POST with lost response, pre-write clock failure, malformed success, older callback uncertainty, no additional POST and no manual queue row. The two focused suites passed 99 tests before dependency updates; current full results are in validation. This fixes a false assurance, **not** manual exactly-once effects. A subsequent user action still requires authoritative backend reconciliation/idempotency and remains a release gate.

**NET-UPLOAD local defect:** four multipart `fetch` paths could wait indefinitely for headers or JSON parsing. `services/api/uploadTransport.js` now gives each upload one 120-second deadline spanning both phases, requests AbortController cancellation, and independently settles local waiting even if the transport ignores abort. The timeout explicitly says confirmation is unknown and asks the employee to inspect the saved request before another upload. It never retries, refreshes credentials, alters multipart fields or declares the file absent.

Leave, expense, complaint and attendance-request services keep their success/result/error-return/throw conventions, including their prior malformed-JSON messages. New `uploadTransport.test.js` cases cover stalled headers/body, ignored abort, late rejection, successful/error timer cleanup, single-call behavior and all four service contracts. Root focused validation passed three suites/112 tests, followed by five capability/manual/localization suites/109 tests. Actual slow-network throughput, native cancellation and backend attachment confirmation still require staging/device checks; no end-to-end latency/battery improvement is claimed.

## Phase 2 continuation — 5 November 2026 (Claude Code handoff)

The previous agent's uncommitted tree was recovered intact: 68 modified tracked files and 32 untracked files on baseline `fa3ed03`. Nothing was reset, cleaned, stashed or reverted. OFF-PAIR, OFF-CLOCK, OFF-MANUAL, NET-UPLOAD and the dependency patches were present and matched their reports. The missing evidence was the final full-suite rerun after OFF-PAIR and the validation of the WAL harness.

**OFF-STRAND (Phase 2 regression, fixed).** The first full run failed one existing test. OFF-PAIR's atomic pairing and confirmed-parent claim guard left a checkout of an `endpoint-missing` checkin `pending` but unclaimable, so it held back every later automatic punch. `markBlocked` (one owned statement) and `enqueue` now place that never-dispatched checkout in the same blocked state as its checkin. Files: `services/offline/AttendanceQueueRepository.js`, `__tests__/attendanceQueueIntegrity.test.js` (+4 cases), `__tests__/androidAttendanceBackgroundWork.test.js` (paired-checkout assertion added; original intent kept with an independent row). [Details](offline.md#off-strand--phase-2-regression-found-by-the-full-suite-and-fixed-5-november-continuation).

**WAL harness hardening (test-only).** `native-tests/sqlite/queue-process-crashes.cjs` now uses real `SIGKILL`, asserts the commit is still in the WAL before reopen, and adds a kill point at the admission statement's final parent-link write (6 scenarios, mutation-checked). [Details](offline.md#wal-process-kill-harness--reviewed-and-hardened-5-november-continuation).

**Reviewed, no change needed:** lease bounds and recovery (`claimPredicate`, `releaseStuckSyncing`), atomic rejection cascade, manual outcome classification, `uploadTransport` (race settlement, timer cleanup, no retry) and the dependency graph (`npm ls` clean, audit matches the stored inventory).

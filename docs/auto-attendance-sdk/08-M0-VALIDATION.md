# 08 — M0 validation and extraction readiness

Date: 2026-10-09. Reference source: `claudion-checkin`, branch
`feat/crashlytics`, HEAD `de722c954621bd0eeb980917f397677df9bdc69e`.

**M0 supplies JavaScript characterization and a proposed extraction contract; it
does not extract SDK/native code or approve business-rule changes.** The source
app remains the reference implementation. See [09](09-SDK-DECISIONS.md) for 16
proposed decisions and [10](10-M1-IMPLEMENTATION-HANDOFF.md) for the native
extraction handoff.

## Safety and baseline

The active chat workspace is `ui-shared-code`; the real reference app was
located at `/Volumes/DevSSD/Projects/claudion-checkin`. The requested files were
added to that original app with authorized filesystem escalation, without a
branch switch, reset, history rewrite, commit, dependency change, or production
edit. Existing Crashlytics work remains on `feat/crashlytics`.

At the start, `git status --short` showed only untracked
`docs/auto-attendance-sdk/` with the eight original audit documents. No tracked
uncommitted changes existed. All eight documents were already read during the
SDK foundation audit; their SHA-256 values match the original app copies and
they remain unchanged. Relevant source and tests were inspected again for M0.

The earlier unmodified-source baseline had 86 passing suites / 1,954 tests. The
source's committed Jest configuration excludes the stale `.git-rewrite/`
snapshot and `.expo/`; those directories were preserved. Tests use existing
jest-expo configuration and mocks. `--forceExit` addresses existing async
handles and emits Jest's warning; it is not evidence of native cleanup.

## Files and test boundaries

Added to the original app:

- `__tests__/autoAttendance.characterization.test.jsx`
- `__tests__/autoAttendanceQueueProvenance.test.js`
- `docs/auto-attendance-sdk/08-M0-VALIDATION.md`
- `docs/auto-attendance-sdk/09-SDK-DECISIONS.md`
- `docs/auto-attendance-sdk/10-M1-IMPLEMENTATION-HANDOFF.md`

The three handoff documents are also mirrored into the SDK monorepo so another
agent can use them there. Its foundation implementation audit links the new
evidence. No SDK implementation was added during M0.

The bootstrap suite executes the real `AutoAttendanceBootstrap`, root Redux
reducers, session authority and lock, replay evaluator/high-water storage,
queue-scope capture, and actual apiClient logout/terminal-refresh teardown. HTTP
responses, location/native APIs, notifications, and delivery service are
boundary mocks. It verifies which scope and action bootstrap passes to delivery;
the queue suite verifies the actual SQLite effects separately.

The queue suite executes the real queue service, repository/schema, offline
gate/config/provenance, sync/verification, attendance API payload building,
clock and session transition logic. Native SQLite is the existing sql.js-backed
`test-utils/expoSqliteMock.js`; HTTP, connectivity and native location are
mocked. This establishes SQL/JavaScript contracts, not disk durability after OS
kill.

Bootstrap restart cases unmount and remount the component while retaining mocked
AsyncStorage. They do not restart an OS process. Monitoring teardown assertions
verify a `stopGeofence` request, not successful removal of an OS registration.

Explicit logout is characterized at real credential/reducer teardown and shared
attendance-cleanup seams, not by mounting Profile's UI or asserting FCM cleanup.
Terminal expiry is additionally exercised through real apiClient/Axios 401 and
refresh-rejection handling in the bootstrap suite. Queue expiry/logout cases
invoke shared offline cleanup and mirror auth invalidation/removal; their names
do not imply separate mounted UI/interceptor executions. The source App cleanup
registration and Profile path are inspected as source facts.

Employee/tenant login tests exercise real session-owner/provenance/reducer
boundaries, not full QR provisioning or every mobile login screen. Existing
`mobileAuthSession` coverage is included in relevant tests and verifies the
mobile handoff's separate tenant-change session clearing. All fixtures use
synthetic employees, reserved example domains, and fake token strings.

## Current-behavior characterization

Every executable new test is named `characterizes current behaviour:`. Passing
assertions intentionally reproduce defects; they do not endorse them.

| Scenario                             | Real boundary and observed result                                                                                                                                            | Classification / risk                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A: old native replay                 | Bootstrap sees a native-shaped bridge response predating `scopeObservedAt`, despite valid current provisioning, and passes `sourceScope: null`                               | Provenance defect; RK-01                                                         |
| A: failed replay queues              | Actual online API fails; cached-policy gate accepts locally; SQLite row has employee A, NULL tenant, and pending status                                                      | Unattributed payroll; not a guessed tenant                                       |
| A: NULL stall                        | Scoped claim/drain does not claim that row, but it blocks a younger attributable same-employee row; counts still include both                                                | Critical queue stall; no bulk calls                                              |
| A: later OUT                         | After locally accepted queued IN, an online OUT can succeed directly and close local session while IN remains undelivered                                                    | Conditional on server acceptance; transport/order defect                         |
| B: manual OUT inside                 | Real session opens/closes manually; bootstrap unmounts/remounts with an inside GPS result and server closed; startup produces AUTO IN                                        | Surprising presence behavior; P-3/P-4                                            |
| C: office moved                      | JS resolves and tags attendance with new office, but existing monitoring flag prevents second `startGeofence`                                                                | Stale OS registration versus current JS office                                   |
| C: employee reassigned               | Changing employee resolves their new office but still trusts the old monitoring flag                                                                                         | Stale monitoring across reassignment                                             |
| D: automatic metadata                | Actual online request has `auto: true`; queued row has internal `attendanceType: 'auto'`; queued payload and actual bulk record omit `auto`                                  | Backend source inconsistency; B-1                                                |
| E: explicit logout                   | Real `clearTokens`/`clearStore` resets opt-in and login; mounted bootstrap requests `stopGeofence`; persisted JS session/owner and processed mark remain                     | Retention fact; native clearing is not invoked                                   |
| E: terminal expiry                   | Actual protected 401 followed by terminal refresh rejection resets opt-in/requests `stopGeofence`, removes tokens, retains session/mark                                      | Same attendance effect as explicit logout                                        |
| E: cross-employee replay             | A's unprocessed native-shaped response remains at the bridge boundary; after logout/login B and new opt-in, bootstrap submits it as B with NULL source scope                 | Missing native ownership allows misattribution                                   |
| E: session ownership                 | `applySessionOwner` clears on employee change, but same employee on another tenant leaves session; processed mark remains global                                             | Owner boundary is employee-only; mobile handoff separately clears tenant changes |
| E: queue isolation                   | Attributable rows survive cleanup; unauthenticated drains refuse; employee/tenant switches upload only current attributable scope; same scope relogin uses fresh credentials | Existing protection works for known scope                                        |
| E: stale auth generation             | Passing an old captured scope after relogin causes a new queue row to become unattributed                                                                                    | New diagnostic finding; historical scope is not retained by this path            |
| F: opt-in                            | Policy refresh after logout/login does not restore `userEnabled`; reactivation requires explicit opt-in                                                                      | Current reset; changing expiry behavior needs approval                           |
| G: ENTER→ENTER                       | First IN completes; second skips under the real shared session authority                                                                                                     | Session guard prevents duplicate submission                                      |
| G: ENTER→EXIT                        | IN then OUT completes, ending checked out                                                                                                                                    | Normal legal sequence                                                            |
| G: EXIT→ENTER, initially closed      | EXIT skips, ENTER completes                                                                                                                                                  | Session legality, not OS deduplication                                           |
| G: EXIT→EXIT, initially open         | First OUT completes, second skips                                                                                                                                            | Duplicate OUT guard                                                              |
| G: concurrent ENTER                  | Both listeners enter the same process lock; only one submission occurs                                                                                                       | Lock spans backend/delivery call                                                 |
| G: offline ENTER→EXIT                | Both accepted locally and paired; real drain sends IN before OUT, one record per bulk request                                                                                | SQL FIFO/pairing contract                                                        |
| G: delayed/duplicate replay          | Crossing timestamp is used; high-water prevents replay after manual OUT makes IN legal again                                                                                 | Replay bookkeeping, separate from session guard                                  |
| G: out-of-order replay               | Earlier/equal processed timestamps skip; EXIT older than an open session is marked handled without closing                                                                   | Replay-only chronology guards                                                    |
| G: out-of-order live callbacks       | Live ENTER at t then EXIT at t−60 seconds submits both; session can have `endedAt < startedAt`, while mark stays t                                                           | Confirmed live chronology gap                                                    |
| G: old/future replay                 | Over 24 hours or beyond 60-second future tolerance is marked handled with no submission                                                                                      | Current discard policy; future journal disposition remains open                  |
| G: refused replay                    | Not allowed result leaves mark unchanged and retries on later mount                                                                                                          | Acceptance controls session/mark commit                                          |
| G: SQL duplicates                    | Same scope/type/second collapses duplicate rows; different tenants stay distinct                                                                                             | Second-resolution unique index, no event ID                                      |
| G: server duplicate                  | Exact matching history verification makes row synced; absent proof makes it `needs_review` and prevents auto resend                                                          | Positive-evidence verification required                                          |
| G: queue-only reversed arrival       | SQL drains by timestamp, but EXIT inserted before matching IN remains unpaired                                                                                               | Repository boundary, not claim that bootstrap permits the sequence               |
| G: JS handle recreation              | Queue survives resetting/reopening the mock's database handle                                                                                                                | No claim of native disk/process-death recovery                                   |
| H: multiple native events without JS | Native stores overwrite one last-event slot; source tracing confirms semantics; harness specification below                                                                  | Native behavior not executed in Jest                                             |

Duplicate protection has several independent authorities. The session machine
serializes legal IN/OUT transitions and skips redundant target states. Replay
high-water suppresses old bridge records. SQLite uniqueness collapses scoped
employee/timestamp/action duplicates; it does not identify physical captures.
Sync uses verified server evidence for duplicate responses. None supplies stable
native event IDs or a durable multi-event capture log.

## Desired SDK regression specifications

The new files include separate desired-behavior `test.todo` groups: **13 TODOs,
zero executed desired-behavior assertions.** They are not counted as passed.
Known defects above demonstrate why certain future desired assertions would fail
against current source; we do not change current assertions to those
unimplemented expectations or disguise them as green SDK tests.

| Specification                        | Desired behavior and present limitation                                                                     | Decision                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bootstrap SDK-A-1 / queue M0-A1 TODO | Capture-time scope survives replay; unattributed legacy rows quarantined without stalling attributable work | ADR-01/07/08; current assertion observes NULL, desired tenant assertion would fail |
| Bootstrap SDK-B-1                    | Approved suppression after manual OUT inside                                                                | ADR-11; current startup submits IN; product rule unapproved                        |
| Bootstrap SDK-C-1                    | Reconcile changed registrations before current-office attendance                                            | ADR-10; current second registration never occurs                                   |
| Bootstrap SDK-E-1                    | Quarantine foreign/unattributed replay                                                                      | ADR-01/07/08; current response can submit as employee B                            |
| Bootstrap SDK-E-2                    | Tenant+employee session ownership, retaining mobile handoff guarantees                                      | ADR-07/12; current owner compares employee only                                    |
| Bootstrap SDK-F-1                    | Approved expiry versus logout opt-in semantics                                                              | ADR-12; desired choice intentionally unspecified pending approval                  |
| Bootstrap SDK-G-1 / queue M0-G2 TODO | Stable-ID delivery deduplication and consistent live/replay ordering                                        | ADR-02/05; current live chronology/second-resolution gaps                          |
| Bootstrap SDK-H-1                    | Native Kotlin/XCTest proves no-JS durability and journal survival                                           | ADR-03; no native harness in M0                                                    |
| Queue M0-A3 TODO                     | Explicit transport/outbox ordering across direct online OUT                                                 | ADR-05/14; current OUT can bypass stalled IN                                       |
| Queue M0-D1 TODO                     | Validated adapter retains automatic origin offline                                                          | ADR-14; current bulk body omits `auto`; backend contract unvalidated               |
| Queue M0-E4 TODO                     | Immutable capture identity across auth generations                                                          | ADR-07/12; current stale scope queues as NULL                                      |

The proposal's named native/SDK test plans in 09/10 are additional written
specifications, not extra passing tests or TODO counts in Jest.

## H: native single-slot evidence and required harness

Source-derived facts:

- Android `GeofenceBroadcastReceiver.onReceive` calls
  `GeofenceStore.saveLastEvent`; JSON replaces preferences key `last_event` in
  `expo_auto_attendance` with asynchronous `apply()`, then the in-process event
  bus emits. When no JS module instance is attached, live delivery is lost. A
  multi-geofence callback stores the first identifier, while live payload
  contains the identifier array. No ID, scope, ack, or history exists.
- Apple `GeofenceManager.handleTransition` writes the dictionary
  `expoAutoAttendance.lastEvent`, then uses its event bus/listener and wake
  notification. Entry, exit, and synthetic initial-inside events replace the
  same slot. Stopping clears monitoring/config, not that last event.
- Therefore ENTER at t1 followed by EXIT at t2 leaves only EXIT available
  through `getLastEvent`. This is a static source conclusion, not a
  killed-app/device test result. Android `apply()` and UserDefaults calls do not
  establish immediate process-kill durability by themselves.

Required current-behavior native harness specifications:

| ID   | Setup/action                                                                                             | Expected current assertion                                                              | Level                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| H-A1 | Isolated SharedPreferences, detached module bus; deliver valid ENTER then EXIT broadcasts                | One parsed `last_event` with EXIT/t2, no native queue/history                           | Android JVM/Robolectric with actual receiver/store                     |
| H-A2 | One delivery with multiple request IDs                                                                   | Stored first ID, emitted array only when attached; detached bus emits to nobody         | Android harness                                                        |
| H-A3 | Wait for preference persistence, create fresh store instance; stop monitoring                            | Latest slot remains; monitoring/config clear separately                                 | Android harness; does not prove kill-before-disk-write                 |
| H-A4 | Deliver then kill process immediately, reopen after restart                                              | Observe whether latest slot survives; report measured loss/durability, not assumed pass | Physical Android/instrumentation                                       |
| H-I1 | Isolated UserDefaults/test seam, no module listener; actual delegate transition handling ENTER then EXIT | One latest EXIT dictionary; wake signal behavior recorded                               | XCTest using actual store/delegate seam                                |
| H-I2 | Initial-state inside followed by actual exit, then stop/fresh store read                                 | EXIT replaces initial ENTER and survives stop according to actual storage               | XCTest                                                                 |
| H-I3 | OS region wakes with no UI scene, time-limited JS startup and immediate kill                             | Measure store survival/remaining runtime/device behavior                                | Physical iPhone                                                        |
| H-V2 | After additive journal implementation, repeat native tests without JS                                    | Both stable-ID scoped records survive commit/restart and require ID ack                 | Future native regression; current implementation lacks this capability |

No harness or Kotlin/Swift production changes were introduced in M0. This
limitation is permitted by the request and remains a native extraction/release
verification requirement.

## Verification results

| Check                                                   | Result                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Bootstrap new suite                                     | 25 passed, 8 TODO, 0 failed; 1 suite                                                                 |
| Queue provenance new suite                              | 16 passed, 5 TODO, 0 failed; 1 suite                                                                 |
| Combined new tests                                      | 41 passed, 13 TODO, 0 failed; 2 suites                                                               |
| Relevant existing tests                                 | 408 passed, 0 failed; 17 suites                                                                      |
| Full source Jest suite                                  | 1,995 passed, 13 TODO, 0 failed; 88 passed suites, 2,008 total tests, 0 snapshots; exit 0            |
| Targeted ESLint static rules for the two added tests    | Passed with explicit parser/Jest environment; source repository has no checked-in lint configuration |
| Prettier for the five new files                         | Passed after formatting                                                                              |
| Original production diff / branch / old document hashes | No tracked diff; original branch/HEAD and all eight original documents unchanged                     |

Commands run from the source-app root; new-test and full JSON reports are
temporary validation artifacts, not repository or release files:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --silent \
  --forceExit --cacheDirectory=/private/tmp/auto-attendance-source-jest \
  --runTestsByPath __tests__/autoAttendance.characterization.test.jsx \
  __tests__/autoAttendanceQueueProvenance.test.js

node node_modules/jest/bin/jest.js --runInBand --watchman=false --silent \
  --forceExit --cacheDirectory=/private/tmp/auto-attendance-source-jest
```

The relevant selection includes bootstrap checkout/presence, geofence event log,
online API, Redux opt-in, session state/authority, offline geofence gate, queue
service/repository/sync, offline API, expiry/auth recovery, session resilience,
mobile handoff, and apiClient suites. Existing native configuration/scene plugin
tests are included in the full run. No device, native compile, live backend,
production token, EAS, npm release, or SDK runtime check is claimed by Jest.

Initial new-test validation exposed harness issues: asynchronous React cleanup
overlapped subsequent mounts, and the duplicate-response fixture lacked required
server-history proof. Cleanup was awaited and the synthetic verified-history
fixture supplied; a separate unverified-duplicate case now asserts
`needs_review`. Current-behavior assertions were not weakened and production was
not changed. Final counts supersede those initial fixture failures.

## Readiness and remaining gates

M0 deliverables consist of the two source-derived characterization suites,
native test specifications, 16 proposed decision records, and comprehensive M1
handoff. They establish the mocked-JavaScript compatibility baseline needed to
review a verbatim native move. They do not establish native binary parity or
approve v2.

M1 can be planned against the verified source and existing
API/identifier/storage inventory. Actual extraction is a separate requested
milestone, not performed here. It still needs Android/iOS build setup, native
characterization/harness work, in-place upgrade/device validation, local-module
deduplication, and binary runtime alignment. Legacy compatibility move and
additive journal/v2 adoption must be kept separate.

Stable-ID journal/scope/ack design is concrete for engineering review in 09/10,
but implementation details are still proposed. Product-dependent behavior
remains unapproved: historical NULL-scope disposition, presence after manual
OUT, office/multi-region changes, capture-versus-processing policy, expiry
consent, retention, backend automatic-origin/idempotency/timezone contracts, and
optional background submission/runtime ownership. An immutable registration
generation requires a callback key that selects it; reusing `office-main` cannot
prove old identity during account switching. Those compatibility changes need
explicit binary/cutover decisions.

No production attendance behavior, Kotlin/Swift file, Frappe endpoint/payload,
Crashlytics change, Git history, or SDK implementation was modified. No commit
or publication was performed.

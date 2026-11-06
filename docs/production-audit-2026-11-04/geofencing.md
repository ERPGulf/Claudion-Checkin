# Automatic attendance and native location audit — 2026-11-04

## Scope and evidence

Reviewed the complete local Expo bridge and its Kotlin/Swift sources in `modules/expo-auto-attendance/`, registration selection in `utils/autoAttendanceRegistration.js`, access/presentation helpers in `utils/autoAttendance.js` and `utils/locationAccessState.js`, `hooks/useAutoAttendance.js`, both registration bootstraps, onboarding and the disclosure component. Read `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, attendance/offline architecture documentation and the installed `write-swift` skill. Applied the skill's resource ownership, callback completion, main-thread and measured-optimization guidance to native review. Consulted `apple-design`; its implementation examples target web UI and did not justify a motion rewrite.

The reviewed eligibility contract remains tenant `attendance_action.geo_tagging === true` plus employee mode 2. Modes 0 and 1 do not monitor, request automatic-attendance location access or punch; mode 1 remains warnings-only without a defined backend warning workflow. No eligibility, attendance payload, queue state machine or native source was changed here.

## Architecture and preserved invariants

- Native capture owns immutable registration/tenant/employee metadata and durable sequence/IDs. Android serializes capture with `GeofenceCaptureQueue`; iOS serializes its journal with `NSRecursiveLock` and uses atomic, synchronized file writes with until-first-unlock protection.
- Native delivery hints are emitted after durable persistence. JavaScript transfers receipts into SQLite before acknowledging their exact native IDs. Missing/stale ownership is retained for review rather than reassigned to the current login.
- Registration uses one physical fence selected from assigned offices. Android uses a new physical UUID on replacement to reject stale callbacks and serializes Play Services mutations. iOS stores pending registration before calling Core Location and rejects confirmations for cancelled/replaced IDs.
- `confirmed_disabled` comes from positive OS service/permission/precision evidence. Failed access reads are `unknown`; poor/no GPS never independently authorizes a checkout. Recovery needs a fresh, accuracy-aware fix within a monotonic 15-second attempt; stale/uncertain fixes retain the episode.
- The shared session transition lock and offline processors own attendance decisions. Native code does not make authenticated attendance requests.
- Android uses WorkManager to start the shared headless JS host; one appended follow-up absorbs events arriving during a running pass. An independent retry timer avoids blocking newly captured work behind `Result.retry()`. Boot/package replacement requests recovery. iOS primes Core Location before JS and uses the existing background runtime; no independent scheduled upload worker exists.
- Permission onboarding waits for fresh tenant/employee answers, runs in the foreground and explains before system prompts. Existing not-now, blocked permission, Settings, approximate-location, RTL/theme and once-per-account behaviors remain covered.

## Confirmed findings and remediation

| ID / priority | Location | Evidence and impact | Remediation / risk / verification |
| --- | --- | --- | --- |
| GEO-01 / P1, fixed | `hooks/useAutoAttendance.js:312`; `components/AutoAttendanceBootstrap.jsx:534`; related helper/onboarding catches | Production listeners logged complete native events. These include employee ID, tenant, office coordinates/radius and timestamps. Legacy registration logged the selected office, and several catches logged arbitrary native/server error objects or text. This exposes employee/location context through application logs. | Removed raw event/geometry parameters and reused the existing bounded `describeHttpFailure` metadata helper for errors. Native error events retain only integer codes. This changes diagnostics only, with low regression risk. A release-mode behavioral test invokes ENTER/EXIT/error callbacks using synthetic private fields and verifies none reach console output. Existing attendance bootstrap tests pass. |
| GEO-02 / P2, fixed | `utils/autoAttendance.js:176`; `components/AutoAttendance/LocationAccessExplainer.jsx:207` | Reproduced with four initially failing tests: hold foreground permission open, then disable tenant geo, change employee 2→1/0 or sign out. Resolving foreground still requested background access, despite eligibility being withdrawn. Unmount had the same lifecycle gap. This requests sensitive permission after its purpose no longer applies. | Disclosure now keeps cancellation for an obsolete request, including teardown. The existing permission sequence checks that request before/after awaited OS reads and before the next prompt; cancellation yields an unanswered result. Current foreground-first sequencing and shared single-flow behavior remain. Low risk; five new cancellation cases and all existing onboarding tests pass. An OS prompt already displayed cannot be recalled. |

Files changed for GEO-01: `hooks/useAutoAttendance.js`, `components/AutoAttendanceBootstrap.jsx`, `components/AutoAttendanceOnboarding.jsx`, `utils/autoAttendance.js`, `__tests__/autoAttendanceHookCapability.test.jsx`.

Files changed for GEO-02: `utils/autoAttendance.js`, `components/AutoAttendance/LocationAccessExplainer.jsx`, `__tests__/autoAttendanceOnboarding.test.jsx`.

## Outstanding limitations and risks

These are established implementation/platform limits or unverified risks, not new confirmed attendance defects.

| ID / priority | Location / evidence | Impact and next action | Change risk / verification |
| --- | --- | --- | --- |
| GEO-R1 / P1 release gate | `GeofenceBroadcastReceiver.kt`, `GeofenceBootReceiver.kt`, `AttendanceSyncWorker.kt`, `AutoAttendanceAppDelegateSubscriber.swift`, `GeofenceManager.swift` | Current-session killed-process, boot, power restriction, locked-device and permission-revocation behavior still needs device validation. A JVM harness and mocked JS cannot prove Android receiver delivery, iOS relaunch, Expo integration or OEM scheduling. | Keep native implementation unchanged until Android/iOS builds and the physical-device matrix pass. Exercise force-stop/force-quit, restart before/after first unlock, background access/precision downgrade and restored access with fresh/weak/no fixes. |
| GEO-R2 / P2 product limitation | `utils/autoAttendanceRegistration.js:67`, bridge `OFFICE_GEOFENCE_IDENTIFIER` | Only one selected office is monitored. A second assigned office is not concurrently registered; with no JS opportunity to reselect, entering that office cannot produce its own region event. This is confirmed by registration shape, not established as a product-contract violation. | Confirm multi-office expectations before expanding registrations. Multiple fences alter ordering, overlap and native persistence semantics; require a designed migration and device tests. |
| GEO-R3 / P2 storage risk | `GeofenceEventJournal.kt:61`; `GeofenceStore.swift:282` | Native journals deliberately retain every unacknowledged receipt and rewrite the serialized collection. Long periods without successful JS transfer can grow disk work and storage. Phase 2 below records a 100/500-capture host workload; no device memory/storage failure was reproduced. | Profile target-device backlogs; consider an append-oriented durable store if needed. Do not cap/evict real receipts as an optimization. Any storage migration has attendance-integrity risk. |
| GEO-R4 / P2 battery risk | `AttendanceSyncScheduler.kt:35,93` | Fixed native retry delays cap at 15 minutes while an offline queue row may have a longer due time. Extra headless wakes are possible without a due upload. Device energy impact is unmeasured. | Correlate wake traces and due times on a test build, then consider scheduling against actionable next-due work. Preserve immediate new-capture wakes and the independent timer; incorrect changes can strand attendance. |
| GEO-R5 / P2 timestamp precision limit | `GeofenceBroadcastReceiver.kt:65`; `GeofenceManager.swift:526` | Receipt timestamps are stamped at native callback receipt, so OS delivery latency remains part of observed attendance time. Server-offset handling cannot reconstruct an exact physical crossing time the OS did not supply. | Document timing expectations and measure real crossings separately per OS; do not claim immediate or exact-boundary punches. Changing timestamp provenance needs a supported native/backend contract. |

Android documents background geofence delays and conditions requiring re-registration in [Create and monitor geofences](https://developer.android.com/develop/sensors-and-location/location/geofencing). Apple documents that Background App Refresh affects region relaunch in [Getting the User's Location](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html). These references support release caveats; they do not establish behavior on this project's target devices. Force-quit/relaunch behavior must be tested on the actual OS/build rather than assumed.

## Validation

- Reproduction run before permission remediation: onboarding suite **4 failed, 48 passed**. The four failures correspond exactly to tenant disable, employee modes 1/0 and sign-out during the foreground prompt.
- Final focused run: **12 suites, 270 tests passed**, zero failures. Suites: `autoAttendanceOnboarding`, `autoAttendanceHookCapability`, `autoAttendanceRegistration`, `autoAttendanceBridgeCapability`, `locationAccessState`, `locationAccessPresentation`, `nativeConfiguration`, `androidAttendanceBackgroundWork`, `AutoAttendanceBootstrap.checkout`, `AutoAttendanceBootstrap.presence`, `autoAttendanceBootstrap.durable`, `locationTimeoutCleanup`.
- Added **6 behavioral cases**: five prompt-cancellation cases and release diagnostic privacy.
- Production Kotlin JVM harness: **28 cases passed**, compiling real `GeofenceEventJournal`, `GeofenceStore`, `LocationAccessPolicy` and `AttendanceSyncDiagnostics` against the repository's filesystem-backed adapters and an existing cached JSON-java jar. Cases cover durable capture, restart/migration, exact acknowledgment, failed writes, scope identity, concurrency, access loss/recovery barriers, scheduling after persistence and release diagnostic suppression.
- Focused ESLint: exit **0**, no errors. Existing hook-dependency warnings remain; root report records full-repository lint.
- No TypeScript application project/typecheck script exists. No TypeScript source was changed.
- Full application Android/iOS build status is recorded in the root audit. No new simulator, real GPS, battery, boot, locked-device or physical-device result is claimed here. No real attendance endpoint was called.

## Performance assessment

No startup, frame, battery, memory or GPS latency improvement is claimed from these changes. Diagnostics now avoid serializing entire native/office/error objects; its runtime impact was not profiled. The meaningful demonstrated improvement is functional: an obsolete permission flow issues **zero subsequent background prompts** in five lifecycle scenarios while valid foreground/background sequencing remains unchanged.

## Additional UI diagnostic privacy remediation

The final privacy sweep extended beyond automatic attendance to both Home variants and HR/camera error paths.

| ID / priority | Location | Evidence / impact | Remediation / risk / verification |
| --- | --- | --- | --- |
| UI-PRIV-01 / P1, fixed | `screens/Home.jsx:27`; `screens/HomeLegacy.jsx:26` | Both variants logged entire FCM topic arrays. Topic naming can contain employee/tenant identifiers. Rejected calls also logged arbitrary error text. | Kept topic counts and replaced error text with existing bounded status metadata. Topic calls, navigation and rendering are unchanged. Low regression risk. Four release-mode cases verify count-only logs and secret-free errors in both variants. |
| UI-PRIV-02 / P2, fixed | `hooks/useComplaint.js:132`; `hooks/useLeaveRequest.js:338`; `hooks/useAttendanceRequest.js:322`; `screens/AttendanceCamera.jsx:247,270` | These catches logged arbitrary backend/native/upload error messages, which can contain private request content or paths. Existing UI already uses curated employee-facing copy. | Reused `describeHttpFailure`; retained submission, recovery, photo follow-up and UI error contracts. Low regression risk. Complaint error test preserves typed form data and fixed alert copy. Camera integration test injects a synthetic private follow-up failure while the real attendance/session path remains active, and verifies the confirmed IN is retained with the photo warning. |

Additional files changed: the six source files above, new `__tests__/homeDiagnostics.test.jsx`, and regressions in `__tests__/complaintsUi.test.jsx` and `__tests__/hybridAttendance.integration.test.jsx`.

Validation: **5 suites / 121 tests passed** (`homeDiagnostics`, `complaintsUi`, `leaveRequestUi`, `attendanceRequestUi`, `hybridAttendance.integration`), including six added behavioral cases. Focused ESLint exited 0 with **0 errors / 3 existing hook-dependency warnings**. No request-frequency/performance improvement is claimed. Shared diagnostic-helper imports add no dependency or native-module requirement.

## Phase 2 — native ingress and receipt recovery, completed 5 November 2026

This pass started from the existing issue register, specifically `OFF-CLOCK`,
`OFF-PAIR` and `RES-JOURNAL`; it did not repeat the application-wide audit.
Queue pairing/upload leases are reported in [offline.md](offline.md). The work
here owns the native-to-SQLite transfer and input-receipt processing leases.

### EVT-CLOCK — P1 confirmed local defect, fixed

`AutoAttendanceEventRepository.claimEvent` previously reclaimed a processing
receipt only once its wall-clock expiry was reached. An input claimed with a
clock six hours ahead remained locked for six hours after clock correction and
reopen; all later inputs for that employee could wait behind it. The two
real-SQL regression cases (dispatched and never dispatched) failed before the
fix: **2 failed / 16 passed** in the focused reproduction run.

The existing 120-second production lease is now an explicit maximum. An atomic
claim can recover an expired lease or one implausibly more than 120 seconds
into the current clock's future. Claim renewal/outcome publication rejects
expired, replaced or implausibly future ownership. The manual reconciliation
fast path observes the same bound. Callers cannot request a nonfinite or
longer-than-supported lease; all production callers already used 120 seconds.

This does not erase `onlineAttemptAt`, `punchTimestamp`, source identity or
payload evidence. A recovered dispatched receipt still performs positive-only
history verification and **never a new attendance POST**. Verified evidence
can restore the session; no exact match remains review-only and holds ordering.
An undispatched input can resume once through the existing admission pipeline.
Normal live claims remain exclusive; after a forward clock jump one claimant
wins and the old owner cannot settle or record another dispatch.

Files changed: `services/offline/AutoAttendanceEventRepository.js`,
`services/offline/AutoAttendanceEventProcessor.js`,
`__tests__/autoAttendanceDurableEvents.test.js`,
`__tests__/autoAttendanceEventProcessor.test.js`. No schema, stored attendance
timestamp, eligibility rule, native production source, migration or backend
contract changed. Regression risk is medium: clock correction may invalidate
an in-flight owner, so its already-started request remains subject to the
existing uncertain-dispatch reconciliation rules.

### Crash boundaries and concurrent admission — existing seam verified

Deterministic fault tests cover a committed SQLite insert followed by failed
readback before native acknowledgment; native acknowledgment followed by
interruption before attendance processing; and simultaneous repeated native
ingress before and after settlement. The original receipt survives reopen,
the unique source ID retains one SQLite row/outcome, and subsequent processing
makes at most one new synthetic attendance request. Existing disk-full and
throwing/false acknowledgment tests continue to pass. No transfer-order change
was needed: SQLite commits before exact native acknowledgment already.

The Kotlin and Swift harnesses now launch a separate child process, append or
acknowledge a synthetic receipt using production journal code, then exit
immediately before application emission/processing. A new process recovers the
unacknowledged capture and does not resurrect the acknowledged one. Kotlin uses
the existing filesystem-backed SharedPreferences adapter; Swift uses the actual
Foundation journal file path with in-memory compatibility defaults. These prove
host process-boundary file behavior, **not** Android OS receiver delivery, iOS
Core Location relaunch or physical-device power-loss durability.

Files changed: `modules/expo-auto-attendance/android/journal-tests/GeofenceJournalHarness.kt`
and `native-tests/ios/GeofenceStoreTests.swift`. The existing `write-swift`
resource-lifetime and explicit-error guidance was applied to the Swift test
additions. No native application source was changed.

### RES-JOURNAL — measured host cost, resource risk remains open

An optimized standalone workload compiles the unchanged production Swift store
and appends synthetic captures into disposable temporary files. One host run:

| Retained captures | Total append time | Mean append | Journal size | Reopen/read | Acknowledge one |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 157.8 ms | 1.58 ms | 34,805 bytes | 0.50 ms | 2.24 ms |
| 500 | 1,681.8 ms | 3.36 ms | 174,205 bytes | 2.31 ms | 6.35 ms |

The code rereads/rewrites the retained collection for each mutation, and the
measurement confirms increasing aggregate work with backlog size. Every
synthetic capture remains present until its exact acknowledgment. This is a
baseline, not a before/after optimization result or an iOS/Android latency,
memory or battery measurement. An append-oriented journal migration or batched
acknowledgment may reduce work, but was not introduced without native-device
evidence and a compatibility/recovery design. No retention cap or eviction was
added. The independent 15-minute native retry wake ladder remains unchanged;
actual excess energy/wake cost is still unmeasured.

Reproduce the host workload by compiling `GeofenceStore.swift`,
`LocationAccessRecovery.swift` and `native-tests/ios/GeofenceJournalWorkload.swift`
with `swiftc -O`, an explicit installed macOS SDK and a supported deployment
target, then running the resulting executable. Temporary fixture files are
removed on completion. The validation run used the installed macOS 27 SDK with
`-target arm64-apple-macosx15.0`.

### Phase 2 validation and remaining closure criteria

- **3 Jest suites / 130 tests passed**: `autoAttendanceDurableEvents`,
  `autoAttendanceEventProcessor`, `autoAttendanceAmbiguousDispatch`.
  Added 14 deterministic cases across lease bounds, rewind/reopen, forward
  jumps, exclusive claims, stale writers, commit/ack boundaries and ingress
  concurrency. All requests use synthetic local mocks; none target a tenant.
- Kotlin JVM harness: **30 cases passed**, including two child-process cases.
- Swift Foundation harness: **103 checks passed**, including four assertions
  across the two child-process boundaries. Explicit SDK/target compilation
  succeeds; a default invocation without an SDK could not locate the standard
  library in this environment.
- Focused ESLint: **exit 0, no errors or warnings**. `git diff --check` passes.
- Native build/simulator results are tracked in the main validation report.
  These harnesses are not substituted for those checks.

Remaining items retain explicit classifications and closure criteria:

| Item / classification | Closure criterion |
| --- | --- |
| Device capture before the first durable commit / external platform dependency | Exercise killed receivers/delegates and locked-device launches on signed target builds. No local journal can recover a callback terminated before any durable write if the OS does not redeliver it. Measure and document that boundary; do not promise lossless capture for undelivered OS events. |
| Ambiguous accepted write / external backend dependency | Verify exact employee/time/type matching, timestamp precision, duplicate envelopes and authoritative history permissions in disposable staging. An incomplete history page cannot prove absence; unresolved outcomes remain review-only. |
| Clock changes during real network/OS work / unverified device risk | Run signed-device forward/rewind/reboot with in-flight uploads and confirm original IDs/timestamps, old-owner rejection and zero blind resend. Normal unchanged-clock reboot can wait up to the remaining 120-second lease; this fix does not identify reboot through a native boot ID. |
| Serialized journal growth and retry wakes / unverified resource risk with host baseline | Record iOS/Android large-backlog drain times, main-thread/receiver budgets and energy traces. Approve any storage/scheduling redesign only with retained-evidence migration and crash tests. |

The locally reproduced input lease defect is closed. Native delivery guarantees,
exactly-once server effects and physical-device battery behavior remain
unverified; this subsystem does not independently satisfy the production gate.

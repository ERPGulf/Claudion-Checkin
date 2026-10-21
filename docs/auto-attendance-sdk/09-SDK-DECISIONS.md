# 09 — Proposed SDK decisions after M0

Date: 2026-10-09. Source reference: `claudion-checkin`, `feat/crashlytics`,
`de722c954621bd0eeb980917f397677df9bdc69e`.

**Status: proposed contracts for review, not approved product rules and not
implemented code.** M0 changes tests and documentation only. Facts below are
derived from the inspected source and characterized in
[08](08-M0-VALIDATION.md). The implementation sequence is in
[10](10-M1-IMPLEMENTATION-HANDOFF.md). Earlier decisions/questions in
[04](04-SDK_ARCHITECTURE.md) and [07](07-OPEN_QUESTIONS.md) remain open unless
an explicit approval is recorded.

The package name, existing monorepo, backend independence, durable event IDs,
capture provenance, acknowledgment, and preservation of production behavior come
from the user's requirements. Specific designs below are proposals for
satisfying those requirements. Product-dependent changes require approval before
enabling them in the existing app. No such approval was received in M0.

## Delivery boundaries

Keep these increments separate:

1. **M1 compatibility move:** package the existing native implementation with
   identical names, storage, methods, events, and attendance decisions. New
   binaries and upgrade/device parity checks are required. This is not yet the
   completed durable SDK.
2. **Additive journal increment:** introduce a versioned native journal and new
   capability-reported APIs while keeping legacy writes/reads and emissions.
   Existing JS continues reading the single last-event slot. Unknown legacy
   identity remains unknown.
3. **Explicit v2 adoption:** enable generation-specific registration identity,
   journal consumption, scope quarantine, and approved SDK behavior. The host
   switches consumers deliberately; do not let legacy replay and v2 replay both
   submit the same crossing. A binary/OTA compatibility plan is required.

“Ready for implementation” below means the technical proposal is concrete enough
to review and build behind the indicated gate; it does not mean approval, native
verification, or production readiness.

## ADR-01 — Capture-time employee and tenant identity

- **Current:** native records contain no employee or tenant. Bootstrap gives
  older replay `sourceScope: null`; queued rows retain employee code but have
  `tenantKey = NULL`. Current source-scope validation protects live queueing and
  drains, but cannot establish who owned an old native event.
- **Proposed:** persist an immutable `{tenantId, subjectId, scopeVersion}`
  snapshot with each v2 registration. `tenantId` and `subjectId` are validated
  opaque host values, not credentials; the host maps its normalized backend and
  employee identity. Every attributable event copies its registration snapshot
  natively. Never derive historical ownership from current login or token data.
- **Why:** establishes provenance before JavaScript runs and separates tenants
  with coincident employee codes.
- **Compatibility risk:** fixes current replay attribution and cross-employee
  replay behavior. Legacy `office-main` callbacks do not inherently identify a
  registration generation; snapshotting the current scope is insufficient.
- **Migration:** M1 keeps legacy payloads. Add nullable journal scope for legacy
  data. Enable verified v2 attribution only with ADR-07's unique native keys.
  Host delivery checks exact current scope before submit/ack.
- **Tests:** SDK-SCOPE-01 capture A, activate B, replay retains A; same employee
  across tenants; delayed callbacks during switch; missing mapping quarantines.
- **Gate:** technical proposal ready for review; P-1/P-2 historical attribution
  and recovery policy require product approval. No approval for guessing scope.

## ADR-02 — Stable event identifiers

- **Current:** timestamp and transition are the only replay identifiers; native
  has no stable event ID. SQL deduplication uses scoped employee/timestamp/type.
- **Proposed:** generate UUID event IDs in native capture, once per journal
  record, and persist them in the insertion transaction. Repeated reads/live
  delivery/retries retain the same ID. A callback covering several native keys
  creates separate records with a shared optional capture-group UUID. Preserve
  IDs across backup-supported migration only when installation identity is
  preserved and verified; never regenerate on replay.
- **Why:** timestamps collide and clocks move. ID acknowledgment deduplicates
  delivery of a stored event without skipping unrelated equal-time events.
- **Compatibility risk:** IDs do not prove that separate OS callbacks represent
  different physical crossings. Do not promise UUIDs deduplicate OS jitter.
- **Migration:** add schema version and ID columns; keep legacy JSON unchanged.
  Persist one import ID for the observed legacy record; an import transaction
  marker prevents repeat import. A changed legacy slot may be imported
  separately.
- **Tests:** SDK-ID-01 stable restart/retry IDs, two events same millisecond,
  multi-key callback, import crash/retry, UUID collision insertion failure.
- **Gate:** technical proposal; backend idempotency-key support remains B-2/B-3
  and must be validated before claiming exactly-once server effects.

## ADR-03 — Durable native event journal

- **Current:** SharedPreferences `last_event` and UserDefaults `lastEvent` each
  retain one value. Android uses `apply()`; source call order persist→emit does
  not establish immediate-kill disk durability.
- **Proposed:** an app-private, versioned native SQLite journal owned by native
  code: Android framework SQLite, Apple SQLite3, serialized native access and
  transactions. No `expo-sqlite` JavaScript runtime is needed for native
  capture. Insert sequence/ID/immutable scope/region snapshot/receipt clocks and
  journal state atomically; commit before live emission or wake notification.
  Proposed WAL/FULL settings and Apple file protection after first unlock
  require native build and interruption tests, not a documentation assertion of
  durability.
- **Why:** transactional records and acknowledgments survive JavaScript absence
  and avoid overwriting ENTER with EXIT.
- **Compatibility risk:** increased disk/write cost; locked storage, disk full,
  corruption, or failure before commit can prevent capture. A journal cannot
  guarantee recovery of an OS callback it never committed.
- **Migration:** separate new database from `claudion-attendance.db`; keep
  legacy last-slot updates in the additive increment. A journal write error
  returns or emits `E_STORAGE` when possible and exposes unhealthy status on
  next runtime; never emit a v2 event as durably captured after a failed insert.
- **Tests:** SDK-JOURNAL-01 native no-JS ENTER/EXIT and restart, crash points,
  transactions, simultaneous receiver/delegate and JS reads/acks, disk full,
  protected storage, migration rollback and corruption handling.
- **Gate:** concrete engineering proposal; native implementation/testing and
  storage/retention review still required. M0 includes no native journal test.

## ADR-04 — Acknowledgment and replay

- **Current:** a global high-water timestamp advances after completed/skipped
  actions and detect-only handling. Replay considers one latest record, within
  24 hours and 60-second future tolerance. Rejected submissions can replay
  later.
- **Proposed:** page unacknowledged journal records by stable native sequence;
  reading and live delivery do not acknowledge. `acknowledgeEvents` validates
  IDs, expected scope/generation, and durable handling receipt, then marks those
  rows acknowledged transactionally. Repeating the same ack is idempotent;
  foreign/unknown IDs cannot delete another scope's records. Host delivery may
  ack after durable host-outbox acceptance, distinct from server confirmation.
  Immutable capture `registrationGeneration`/`scopeVersion` establish
  provenance; the current host auth/lifecycle generation separately guards
  canceled work. A fresh login to the same tenant/subject may handle older
  registration records with fresh authorization. Never require capture
  generation to equal login generation; invalidating an old scope version
  requires an approved quarantine rule.
- **Why:** reliable at-least-once delivery without the high-water race. Crash
  after host acceptance but before native ack repeats delivery of the same ID;
  host outbox must be idempotent on event ID.
- **Compatibility risk:** legacy timestamp semantics and old expired-event
  discard cannot be silently replaced. Transport uncertain-commit duplicates
  remain possible until the backend provides validated idempotency/verification.
- **Migration:** retain high-water bookkeeping in legacy mode. Only one consumer
  owns attendance submission during cutover. Expired, rejected, foreign, or
  unknown-scope v2 records remain auditable and require explicit disposition; a
  replay-age rule alone cannot delete undelivered attendance.
- **Tests:** SDK-ACK-01 live+replay same ID, restart between acceptance/ack,
  repeated ack, partial batch rollback, unknown IDs, stale scope, and no
  implicit ack from a listener or failed submission.
- **Gate:** technical proposal; stale-event disposition/retention and who may
  resolve historical payroll records require product approval.

## ADR-05 — Event ordering and deduplication

- **Current:** session lock spans submit and commits only `allowed`; repeated
  IN/OUT in the same state skip submission. Timestamp high-water applies to
  replay, not every live callback. Offline strict FIFO is per employee/tenant,
  with legacy NULL rows blocking younger rows. Only IN is force-queued behind
  undelivered punches; online OUT can overtake them.
- **Proposed:** native transaction sequence is the delivery order; expose it as
  a decimal string to avoid JavaScript integer precision loss. Wall clock is
  evidence, not the sorting authority. Deduplicate delivery by event ID and
  preserve one session authority for manual/automatic attendance. Optional
  delivery processes FIFO within exact tenant/subject scope. Do not introduce
  debounce, dwell, shifts, or timestamp reordering implicitly.
- **Why:** a backwards device clock must not erase a committed older-sequence
  event; business transition legality is separate from delivery deduplication.
- **Compatibility risk:** changing OUT ordering or legacy NULL blockers changes
  production attendance. Different native callbacks with UUIDs still need the
  session guard; there is no claim of physical-crossing exactly-once semantics.
- **Migration:** legacy session, retry, SQL pairing, and high-water behavior
  stay pinned in M1. A host's v2 delivery adapter adopts stable IDs/FIFO
  explicitly; concurrent foreground/headless work shares processing ownership.
- **Tests:** SDK-ORDER-01 all four transition pairs; offline IN/OUT; equal and
  backwards clocks; concurrent manual/auto; uncertain backend commit and retry;
  rejected IN with dependent OUT; foreign-scope rows do not block own scope.
- **Gate:** technical ordering proposal; changes to OUT submission, boundary
  debounce/dwell, and shift/time-window rules require product/backend approval.

## ADR-06 — Capacity, overflow, and retention

- **Current:** only one native record survives; queued attendance is retained
  without automatic pruning. Earlier proposal combined a bounded journal with
  never deleting unacknowledged records, which needs an explicit policy.
- **Proposed:** no hard row cap that evicts pending/quarantined events. Use
  configurable soft health thresholds (initial review proposal: 200 pending
  records or 10 MiB journal size), diagnostics, and host-visible pressure
  signals. Keep appending while storage works. On full/corrupt storage, fail
  capture explicitly, preserve existing records, and report degraded health; do
  not fall back to a pretending-durable in-memory queue. Paging bounds reads,
  not retention. No auto-pruning until a retention policy is approved.
- **Why:** finite-device storage cannot provide an unlimited guarantee, but
  silent eviction converts a capacity issue into undetectable payroll loss.
- **Compatibility risk:** increased private storage; log exhaustion during long
  offline periods. Hard-stop monitoring or limiting capture would itself change
  attendance behavior and is not approved here.
- **Migration:** journal thresholds are diagnostic only. Acknowledged retention,
  safe compaction, explicit purge/export rights, and foreign-event disposition
  must be separately configured/approved. Do not adopt a guessed seven-day
  default from the older proposal.
- **Tests:** SDK-CAPACITY-01 exceed thresholds without eviction; disk-full
  failed insertion leaves existing data intact; bounded paging; ack compaction
  never removes pending rows; quarantine/export retention.
- **Gate:** concrete non-eviction proposal; P-17 privacy/retention and any hard
  stop/purge/export policy require product approval.

## ADR-07 — Atomic employee/tenant switching

- **Current:** queue provenance captures auth generation and revalidates
  tenant/employee/account across awaits. Session owner compares only employee;
  mobile handoff additionally clears session on tenant change. Native registered
  fence and stored event have no scope/generation.
- **Proposed:** serialize scope/registration mutations natively. Persist new
  desired generation and immutable registration mappings transactionally; stop
  accepting processing under the old active scope before publishing the new
  scope. New v2 native region keys include unique registration generation, for
  example `aa/v2/<registrationGeneration>/<regionId>`; retain old mappings as
  tombstones for delayed callbacks. A callback selects that immutable mapping,
  never current JS identity. Missing/ambiguous mappings quarantine
  nullable-scope records. OS remove/register steps are asynchronous: report
  pending/partial state, not atomic OS success. Keep capture registration
  generation distinct from host auth generation: relogin to the same
  tenant/subject can replay its retained events using current credentials and a
  fresh processing guard. Invalidate in-flight work at a host-auth switch
  without erasing the captured event's ownership.
- **Why:** `office-main` reused across accounts and `FLAG_UPDATE_CURRENT`
  PendingIntent extras cannot establish old callback ownership. Generation-
  specific callback identifiers are required for proof.
- **Compatibility risk:** new OS identifiers are a deliberate migration. Keeping
  the old identifier unchanged and claiming perfect generation attribution is
  impossible for ambiguous delayed callbacks.
- **Migration:** preserve `office-main` in M1. Enable v2 keys only after a
  reviewed binary/cutover plan; never renamespace legacy regions silently. Drain
  old scope only under its authenticated host context. Leave old records owned
  by old scope; no reinterpretation or deletion on switch.
- **Tests:** SDK-SWITCH-01 callbacks at each remove/register/activate await;
  overlapping switches; same employee/different tenant; failed registration;
  restart with partial desired state; missing mapping; stale JS ack/transport.
- **Gate:** technical proposal ready for review; identifier migration, treatment
  of ambiguous historical callbacks, and stale-scope recovery require approval.

## ADR-08 — Unattributed legacy events

- **Current:** legacy native JSON/dictionary contains transition, identifier,
  and timestamp. Cold replay can queue NULL tenant rows; the recovery UI refuses
  automatic resend of unattributed rows.
- **Proposed:** import observed legacy last-event data with a stable import ID,
  `scope: null`, `policyAtCapture: null`, and
  `quarantineReason: 'legacy-scope-unknown'`. Never infer identity from current
  tenant, employee, region location, or latest policy. Only the single remaining
  slot can be imported; overwritten history cannot be reconstructed.
- **Why:** avoids fabricating historical payroll attribution.
- **Compatibility risk:** automatic legacy replay remains possible in legacy
  mode; switching to quarantine changes its behavior and may leave unresolved
  records visible to users/support.
- **Migration:** additive import does not clear the old slot/high-water. Record
  import marker and row in one transaction. Cutover must explicitly choose
  legacy processing versus quarantined review, with no duplicate submission. Do
  not rewrite existing NULL-tenant SQLite attendance rows.
- **Tests:** SDK-LEGACY-01 absent/corrupt/dictionary records, crash during
  import, repeated import, changed legacy slot, same timestamps, and current
  login never supplies the missing historical identity.
- **Gate:** non-inference is an engineering invariant; P-2 disposition and
  reviewed manual attribution/audit workflow require product approval.

## ADR-09 — Native and persistence compatibility

- **Current:** module `ExpoAutoAttendance`; Kotlin namespace/classes
  `expo.modules.autoattendance.*`; PendingIntent request code `4821`; Android
  preferences `expo_auto_attendance` with `monitoring`, `geofence`,
  `last_event`; Apple `expoAutoAttendance.monitoring|geofence|lastEvent`; event
  names `onGeofenceEnter`, `onGeofenceExit`, `onError`; wake notification
  `ClaudionGeofenceTransition`; region `office-main`.
- **Proposed:** retain all identifiers, serialized field names, method
  sync/async forms, and legacy writes during M1. Add separately versioned v2
  APIs/records; report capabilities so older binaries remain usable.
- **Why:** OS registrations target class names/region identifiers and persisted
  app data must remain readable during upgrade and OTA rollback.
- **Compatibility risk:** duplicate autolinked module names, renamed receivers,
  or deleting old storage can orphan monitoring or break rollback.
- **Migration:** remove the local module only in the source-app integration
  change that consumes the package; never install two copies. Native binaries
  require runtime-version alignment in app config and committed iOS Expo plist.
  Preserve legacy session keys and SQLite schema v4 until a separately tested
  migration. Guard missing new methods in old binaries.
- **Tests:** SDK-COMPAT-01 exported legacy API parity, upgrade in place,
  boot/package-replaced restoration, old JS/new binary and new JS/old binary,
  legacy last-event reads, app suites unchanged.
- **Gate:** required for the behavior-preserving move; physical Android/iOS
  upgrades and binary build checks remain required, not completed by M0.

## ADR-10 — Registration reconciliation

- **Current:** bootstrap fetches an office each run but calls start only when
  persisted `isMonitoring()` is false; moved office remains stale. Android
  cannot query its Play Services registrations directly through current API; iOS
  manager exposes monitored regions, while current boolean still uses prefs.
- **Proposed:** separate desired config, OS acknowledgment, and effective
  health. Compare desired region revision against acknowledged revision;
  reconcile changed registrations in v2. Android acknowledgment is explicitly
  evidence from successful registration for a process/boot epoch, not a claim
  that Play Services still retains it. Apple compares SDK-owned monitored region
  IDs. Surface partial failure, permission changes, and provider-unavailable
  state.
- **Why:** a preference alone cannot prove effective monitoring.
- **Compatibility risk:** re-registration can trigger an initial ENTER and
  introduce attendance; multiple-office monitoring expands current nearest-only
  behavior and could require paired site/session rules.
- **Migration:** M1 retains stored-flag behavior. Add observational status
  first; enable changed-office reconciliation only after initial-state handling
  and multi-office policy are approved/tested.
- **Tests:** SDK-REG-01 changed coordinate/radius, repeat initialize, partial OS
  registration, boot recovery, permission removal/regrant, provider failure, own
  versus host-owned regions, in-place upgrade.
- **Gate:** status proposal concrete; P-5/P-6 office update/multi-office and
  synthetic-initial-event attendance decisions require product approval.

## ADR-11 — Manual checkout and GPS presence

- **Current:** startup presence can open a new AUTO session after manual OUT
  while still inside, if no queued evidence and server says closed/unavailable.
  Presence runs on each startup/effect sequence; GPS fix has no bounded timeout.
- **Proposed:** expose presence as a host policy with trigger strategy, timeout,
  accuracy threshold, and remote evidence rules. Recommended v2 option is
  on-first-registration, with explicit suppression after manual OUT until a
  verified departure/re-entry or a host-approved reset. Exact reset boundary and
  server-offline handling are business decisions, not inferred rules.
- **Why:** prevents location alone from silently reversing a deliberate punch.
- **Compatibility risk:** suppressing presence can miss intended initial IN;
  continuous every-start behavior is the existing application contract.
- **Migration:** compatibility mode preserves every-start presence, shared
  session guard, server/queue evidence order, and timestamps. No recommended
  suppression flag becomes default without approval.
- **Tests:** SDK-PRESENCE-01 manual OUT inside then restart; genuine re-entry;
  manual IN then automatic EXIT; remote-open and unknown evidence; queued OUT;
  timeout/poor accuracy; clock/day boundary selected by approved policy.
- **Gate:** P-3/P-4 and absence-of-server-answer policy require product
  approval.

## ADR-12 — Token expiry versus explicit logout

- **Current:** terminal refresh rejection and explicit logout clear credentials
  and dispatch `REVERT_ALL`, resetting opt-in; bootstrap requests a monitoring
  stop. Transient refresh failures retain the session. Native
  last-event/high-water and queued rows are not cleared by token teardown.
  Profile logout also invokes offline cleanup; mere `clearTokens()` does not
  perform the whole Profile flow.
- **Proposed:** host tells SDK an explicit lifecycle reason. Explicit sign-out
  stops monitoring/deactivates scope but retains journal/outbox. Authentication
  suspension pauses server submission and preserves existing event ownership.
  Continuing native capture or retaining opt-in across terminal expiry is a
  separate product policy. SDK never stores/refreshed credentials or launches
  interactive authentication on a background wake.
- **Why:** expiry, temporary offline refresh failure, employee switch, and
  deliberate logout have different ownership/consent implications.
- **Compatibility risk:** retaining monitoring across terminal expiry changes
  current opt-in reset and privacy expectations.
- **Migration:** legacy host keeps existing cleanup. Optional reason-aware
  lifecycle is adopted with host consent/retention rules; never reset/delete
  records just to obtain a green drain.
- **Tests:** SDK-AUTH-01 transient versus terminal failure, explicit logout,
  token rotation during delivery, relogin same scope, another employee/tenant,
  delayed auth callback, monitoring stop failure and retry.
- **Gate:** P-9/P-10 consent and feature-switch behavior require product
  approval; token mechanisms remain host-owned.

## ADR-13 — Native background capture versus submission

- **Current:** Android receiver persists/emits and never submits or starts JS.
  iOS delegate persists/emits/posts a notification; the app shell may start a
  windowless JS root. Neither native module performs HTTP attendance submission.
- **Proposed:** native SDK v1 guarantees only verified capture/journal behavior;
  JavaScript processing requires a running runtime. Replay starts when the host
  starts SDK processing. Background server submission is a separately advertised
  opt-in capability only after physical-device validation.
- **Why:** separates observable native work from unavailable JS/network effects.
- **Compatibility risk:** promising killed-process server submission would
  overstate source capabilities; starting extra runtimes risks duplicate work.
- **Migration:** keep deferred Android submission; optional worker/headless
  integration is later and uses the same ID/ack/session ownership. No HTTP in
  native capture and no embedded backend/auth state.
- **Tests:** SDK-BACKGROUND-01 native killed-runtime capture, startup replay,
  interrupted iOS processing, foreground/background overlap; experimental
  Android worker retry/quota/OEM behavior on physical devices.
- **Gate:** P-13 latency/product requirement and optional background execution
  require approval and device evidence.

## ADR-14 — Optional transport and offline retry

- **Current:** online auto path sends `auto: true`; bulk queued path omits it.
  Automatic offline acceptance is gated by cached config; manual is online-only.
  Queue retries preserve strict claim/order/verification behavior; unknown
  failures remain recoverable instead of terminal rejection.
- **Proposed:** core is events-only and backend independent; optional delivery
  integrates through the host's shared attendance session authority. The native
  event core owns capture/replay, not attendance business decisions; an optional
  engine must coordinate manual and automatic actions with that same authority.
  Optional delivery calls typed host `AttendanceTransport`. Durable host outbox
  uses unique event IDs and scoped FIFO. Preserve accepted/queued versus
  server-confirmed results, positive duplicate verification,
  retry/blocked/rejected distinctions, and single-flight drains. Native journal
  is not a backend outbox substitute.
- **Why:** host owns authentication/endpoints/timezone/error contracts; reliable
  capture should not require ERPNext, Frappe, or the auth SDK.
- **Compatibility risk:** fixing queued `auto`, idempotency, source location
  tags, payload timestamp semantics, or outbox-first acceptance changes
  contracts.
- **Migration:** bridge existing delivery first. No full Frappe adapter before
  backend contracts validate `auto`/idempotency/response shapes/timezone.
  Preserve current API payload and schema v4 until that separate change.
- **Tests:** SDK-TRANSPORT-01 classification, transient/blocked ladders, FIFO,
  offline IN→OUT, unknown exceptions, uncertain commit, verified duplicate,
  scoped token rotation/cancellation, payload parity and staging contracts.
- **Gate:** core boundary comes from user requirements; P-15/P-16 and B-1
  through B-9 backend changes remain approval/validation-dependent.

## ADR-15 — iOS background runtime ownership

- **Current:** `native/ios/AttendanceBackgroundRuntime.swift` and
  `plugins/withAttendanceBackgroundRuntime.js` belong to app shell, with
  committed AppDelegate/scene/Updates integration and a 25-second task cap.
- **Proposed:** native core emits the compatible wake signal; host owns runtime
  startup by default. An optional separately gated Expo-57-specific integration
  may later package the existing runtime, scene reuse, once-per-process guard,
  and remaining-time/cancellation handling. It must refuse unsupported scene or
  AppDelegate shapes rather than rewrite them generically.
- **Why:** app lifecycle/OTA/scene assumptions do not belong in a generic native
  capture module, and available wake execution time is device-dependent.
- **Compatibility risk:** two React roots, startup OTA reload, Firebase wake
  coupling, or changed scene layout can lose/duplicate processing.
- **Migration:** keep current app shell during M1. Do not delete the app runtime
  when moving its module. Optional plugin adoption is a separate binary/runtime
  change with factory/scene parity and device proof.
- **Tests:** SDK-IOS-RUNTIME-01 windowless startup and scene reuse, time expiry,
  OTA reload, wake before hydration, Firebase wake opt-in, unknown scene/plugin
  refusal, actual cold region wakes on physical iPhone.
- **Gate:** G-3 ownership and I-5 notification coupling remain product/host
  integration decisions. Native builds and devices are required.

## ADR-16 — Cross-platform capabilities

- **Current:** Android Play Services and Apple CoreLocation differ in
  permission, accuracy, initial-state, restoration, region limits, and process
  wake behavior. Source targets Expo 57/RN 0.86.3/iOS 16.4/Android min24
  target36. Existing mocks do not establish native compatibility or force-quit
  behavior.
- **Proposed:** capability/status reports explicitly identify available module
  version, journal/schema support, platform permission/accuracy status, maximum
  region count, registration evidence type, and background processing support.
  JS checks new-method presence on older binaries; unsupported methods fail with
  typed errors rather than mock success. Platform differences remain visible.
- **Why:** hosts can make honest decisions without relying on a persisted flag
  or a uniform background-execution promise.
- **Compatibility risk:** mandatory new APIs on old OTA binaries; generic
  permission prompts can violate platform sequencing or omit host disclosure.
- **Migration:** publish only the actually tested matrix. Use development builds
  for custom native modules and Expo Modules infrastructure in bare RN; no Expo
  Go support claim. Android/iOS registration, permission, and native compilation
  must be checked independently.
- **Tests:** SDK-CAP-01 absent module, old binary, denied foreground/background,
  Apple reduced accuracy, disabled provider, platform capacity, Android reboot/
  upgrade, iOS state retry, and physical-device force-stop/force-quit
  differences.
- **Gate:** G-2 support matrix, permission/disclosure copy, and force-quit
  product messaging require host/product review and platform/device validation.

## Approval and implementation ledger

No decisions are marked approved by this document. A later approval should
record decision ID, owner, date, exact option, rollout flag, affected binary
runtime, and rollback/data compatibility plan.

Ready for technical planning: backend independence, preserve legacy names/data,
stable native IDs, persist-before-v2-emit, ID-based durable acknowledgment,
explicit unknown provenance, registration evidence/status, nullable-scope
quarantine, and no silent pending-event eviction. The proposed implementation
details still need code review and native verification.

Explicit product gates: historical payroll attribution/disposition (P-1/P-2),
presence (P-3/P-4), office/multi-region updates (P-5/P-6), debounce/time windows
(P-7/P-8), expiry opt-in/admin gates (P-9/P-10), policy authority/capture timing
(P-11/P-12), background submission (P-13), queued location/notification/privacy
(P-14/P-15/P-16), retention (P-17), spoofing (P-18), platform messaging/purpose
strings (P-19/P-20), background-runtime ownership (G-3/I-5), and backend
contract changes (B-1 through B-9).

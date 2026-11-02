# Location-access checkout and recovery

Automatic attendance distinguishes OS authorization from GPS reception. A weak,
inaccurate, missing, or timed-out position never proves that an employee disabled
location access. Indoor signal loss, battery saver, disconnected networks,
generic geofence errors, and failed OS reads do not create an access-loss punch.
An existing automatic check-in remains active in these conditions.

## Access and attendance rules

- `confirmed_disabled`: a successful OS query explicitly reports that required
  services, foreground/background permissions, or precise authorization is off.
- `confirmed_available`: successful queries confirm every required setting.
- `unknown`: current access cannot be established. Preserve attendance and retry.

The native module records the first observed confirmed loss before repairing
monitoring. This includes Android process restarts after permission/precision
changes: the restart observation is the earliest known time unless an earlier
loss receipt was already durably captured. No earlier departure/revocation time
is inferred from the last fix, last foreground, or process death.

Only a matched AUTO-origin session can be closed by the new rule. A cutoff uses
the observed loss timestamp and passes through the existing session transition,
tenant/employee eligibility, API, and offline queue contracts. Manual and unknown
sessions and ordinary native ENTER/EXIT behavior retain their existing rules.
Older active sessions without trustworthy registration-generation provenance
cannot authorize this new cutoff/recovery; ordinary geofencing remains available.
Routine server-status normalization retains an AUTO receipt's causal identity
only when its frozen server-format timestamp matches exactly. A nearby or
different timestamp cannot inherit that receipt or its registration generation.

## Durable recovery

Loss and recovery are typed journal receipts, distinct from physical crossings.
The first loss and open episode are persisted atomically. Exact event IDs,
ordered sequences, tenant/employee ownership, registration-generation identity,
and the target AUTO session prevent replay from producing duplicate punches.
Historical journal receipts and queued punches are retained.

Temporary access loss retains registration intent. Real logout, administrator
disablement, or registration replacement cancels recovery intent without deleting
captured receipts. A logical registration generation survives same-intent repair;
recovery cannot authorize attendance under a newer employee, tenant, or generation.

Each episode permits one recovery position request at a time. The 15-second
timeout cancels the underlying request and invalidates its attempt token; a late
callback cannot settle a newer attempt. Failed, timed-out, and uncertain attempts
remain retryable on access changes, foreground, and existing foreground retries.
Monotonic deadline checks also reject late callbacks if OS suspension delayed
the timeout handler. Public native status observations retain a confirmed loss
before returning, rather than waiting for a later foreground poll.

Recovery uses an uncached fix observed after the request started. With distance,
horizontal accuracy, and office radius in metres:

- Inside: `distance + accuracy <= radius`.
- Outside: `distance - accuracy > radius`.
- Otherwise: uncertain; retain recovery and retry without a punch.

Outside recovery creates no new checkout. Verified inside recovery can create one
replacement IN only after the original cutoff was accepted online or durably
queued, and only for the exact closed AUTO session with no intervening manual
activity. Existing queue eligibility and uncertain-request verification still
apply. Initial ENTER callbacks captured during recovery cannot later bypass the
fresh-location verification. Android repairs suppress the initial ENTER trigger.
After verified outside recovery, a later genuine ENTER can start a new session;
the repair itself cannot synthesize attendance from a cached presence estimate.
iOS keeps its single bounded provider stream alive through cached and uncertain
fixes so a subsequent fresh observation can complete the same request.

Both screen variants show English/Arabic waiting messages. An actual weak or
missing fix during an active AUTO session reports that the current check-in
remains active. That message is not shown after an access-loss cutoff. These
presentation states never authorize attendance.

## Timestamp and staging acceptance

The client freezes the original event time before dispatch and preserves that
timestamp through queued upload and retry. The backend implementation is not in
this repository. An inserted acknowledgment proves acceptance, not independently
that the server retained the supplied timestamp.

Before rollout, use a disposable staging employee and controlled office:

1. Establish a legitimate AUTO IN. Record a confirmed access-loss observation at
   time T while offline. Keep the cutoff queued, restart, and upload later.
2. Read raw Employee Checkin/history data. Require exactly one OUT for the same
   employee at the frozen timestamp T, not the upload time.
3. Repeat delayed online delivery, duplicate handling, and timeout-after-commit.
   Confirm the original timestamp and one stored OUT across all retries.
4. Restore access with an uncertain fix: require no new punch. A subsequent fresh
   inside fix may create one IN for the original matched episode.

Real simulator testing also observed two identical Android OUT HTTP requests
after a disconnect following backend acceptance. The local mock atomically
deduplicated them into one record. Native transport replay is outside JavaScript
event claims, so require atomic backend idempotency for the same employee, action,
and original timestamp (or a coordinated idempotency key) for both endpoints.
Live server duplicate protection remains unverified.

If the endpoint substitutes receipt time or does not deduplicate acceptance retries,
the backend needs correction; do not
silently change the established client payload shape. Existing wire precision is
seconds, and the offline clock uses the tenant's cached server offset. Device
clock changes during an outage and timezone/DST changes remain timing limits.

## Local validation (2026-10-30)

| Check | Result |
| --- | --- |
| Full Jest, serial with Watchman disabled | 150 suites and 3,163 tests passed; 13 existing TODOs. `--forceExit` accommodates the existing open-handle issue. |
| Android native JVM journal/store/policy harness | 25 cases passed, including failed persistence, restart deduplication, generation matching, nested bridge data, and recovery barriers. |
| iOS Foundation journal/recovery harness | 99 checks passed, including accuracy boundaries, persistence, stale attempt ownership, and monotonic timeout rejection. |
| Android `assembleRelease` and `lintVitalRelease` | Passed for `arm64-v8a`, including the production JavaScript bundle. Other ABI packaging was not rebuilt. |
| iOS simulator application build | Unsigned Debug ARM64 build passed with the iOS 27 simulator SDK. |
| ESLint | No errors; 19 existing hook dependency warnings remain. |
| Localization, native plists/project, whitespace | Passed; English/Arabic resources have no missing keys or conflicting translations. |

UI regressions cover both modern/classic screens, light/dark themes, and English
and Arabic. Actual Android 15 emulator and iOS 26.5 simulator runs also exercised OS access
changes, real geofence crossings, native/SQLite persistence, recovery, and delayed
offline synchronization against an isolated local backend. Those runs found and
fixed Android outside-recovery ENTER suppression and iOS cached-fix starvation.
See the [integration report](testing/location-access-emulator-2026-10-30/REPORT.md)
for evidence and the untested matrix. These results do not establish physical
OS delivery or live tenant compatibility. No staging attendance was submitted.

## Native release and physical-device checks

This capability requires native builds with runtime
`1.2.1-sdk57-location-cutoff-v1`, Android versionCode 24, and iOS build 16. An OTA
cannot add the new native observers or recovery API; bridge access remains guarded
for older binaries.

Validate indoor weak reception, service toggles, each permission/precision change,
Android permission-triggered process restart, background callbacks, access-read
failure, timeout/late-callback races, and force-stop/terminated-app relaunch on
physical Android and iOS devices. Check both themes, screen variants, and EN/AR.
Native builds and mocked tests do not establish actual OS wake behavior or live
backend compatibility. A complete off/on cycle that the OS never delivered while
the app was terminated cannot be reconstructed by mobile-only enforcement.

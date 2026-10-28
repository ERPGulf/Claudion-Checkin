# Performance, memory and background work

Date: 2026-10-28. Findings refer to current source; before-behavior was established from baseline code and targeted regressions. No release/device performance profile was collected.

## Confirmed findings and fixes

| ID / severity | Evidence and root cause | Impact / smallest fix | Regression |
| --- | --- | --- | --- |
| F05 Medium | [WelcomeScreenModern.jsx:89](../../screens/WelcomeScreenModern.jsx#L89), ShimmerField and AccentHalo: retained native-stack Welcome kept three drift and three halo loops running behind pushed auth screens | Gate decoration on screen focus and active AppState; stop/park on blur/background, resume on visibility | motionLifecycle: focus/background/resume/unmount and subscription cleanup |
| F06 Medium | [BackgroundSyncManager.js:233](../../services/offline/BackgroundSyncManager.js#L233), [durable bootstrap:129](../../components/DurableAutoAttendanceBootstrap.jsx#L129): periodic callbacks ran whenever JS remained runnable, despite foreground-only intent | Gate periodic callbacks on active AppState; keep native events, launch, queue kick, reconnect/token and foreground triggers | backgroundSyncLifecycle and real mocked-SQLite durable-bootstrap lifecycle case |
| F08 Medium | [offlineAttendanceGate.js:35](../../services/offline/offlineAttendanceGate.js#L35), [autoAttendance.js:102](../../utils/autoAttendance.js#L102): losing Promise.race timeout stayed scheduled after immediate GPS success/failure | Clear deadline in finally, retaining timeout fallback | locationTimeoutCleanup: success, rejection and timeout for both helpers |
| F12 Medium | [crashlytics.service.js:27](../../services/crashlytics.service.js#L27), recordNonFatalError: unique error fingerprints accumulated for the entire process with no bound | Retain latest 128 distinct fingerprints, evict oldest; keep recent duplicate suppression | crashlytics.service capacity/eviction/re-report test |

F01 also releases prior-session query/mutation cache references at invalidation. F04 consolidates three duplicate skeleton pulse implementations into the existing shared hook and stops their loops under reduced motion. Those findings are detailed in the architecture/UI reports.

## What was measured

These are deterministic mocked resource observations, **not CPU, heap-byte, FPS or battery measurements**.

| Work/resource | Before evidence | After regression observation |
| --- | --- | --- |
| Welcome decorative loops while hidden | Six loops start on mount; no focus/AppState gate in baseline | All six stopped on blur/background/unmount; six resume only while visible/active |
| Skeleton under known reduced-motion setting | Each implementation unconditionally starts one loop | Zero loops scheduled; static placeholder remains visible |
| Settled GPS attempt deadline | Baseline race retains one 8s/12s timeout until expiry | Timer count returns to baseline immediately after success/rejection; actual timeout still falls back |
| Background periodic callbacks | Baseline callbacks invoke work without AppState check | Zero periodic sync/config/replay invocations on inactive/background ticks; explicit recovery triggers preserved |
| Diagnostic fingerprint retention | Set has no entry-count ceiling | Recent distinct window capped at 128, oldest fingerprint eligible again after eviction |
| Prior-session query cache | Baseline singleton outlives login/navigator swaps | No prior query/mutation entries after invalidation; late result cannot resurrect into a reused key |

No startup/navigation/render duration, DB latency, real network-frequency trace, process heap/RSS, CPU, battery wakeup or frame-drop delta was obtained. Bundle exports establish bundling compatibility only. Jest runtimes are validation durations, not application speed measurements.

`App.js` awaits startup resource hydration and an enabled production OTA check/fetch before mounting bootstraps. Network-dependent startup delay, especially during a native background wake, warrants measurement. No indefinite hang or missed crossing from that sequence was reproduced, so the OTA policy was not changed as an alleged performance fix.

## Reviewed and deliberately preserved

Native-driver transform/opacity animations are already used. Installed RN 0.86 defaults native animations' interaction-handle setting to false (`node_modules/react-native/Libraries/Animated/animations/Animation.js`); missing explicit `isInteraction:false` is not a demonstrated list starvation bug. Existing loops stop on unmount; an unbounded animation leak was not established.

HR list pagination and attendance grouping are already memoized/virtualized where implemented. APIs that return a whole history cannot gain server pagination without an endpoint change. No speculative blanket memoization, FlatList tuning or memo comparator was introduced.

SQLite claims, deduplication, leases, timestamp/source ordering, reciprocal IN/OUT pairing, one-record uploads, migrations and uncertainty evidence remain intact. Journals/outbox intentionally retain unresolved attendance; adding a capacity eviction or deleting old pending work would trade payroll durability for memory and was rejected. Synchronous native journal rewrites may scale with retained ingress, but no measured latency justified a storage rewrite.

SDK clients and clock offsets retain tenant-keyed in-memory maps. Human tenant-switch workload and object retention need profiling before choosing cache eviction that could interfere with in-flight SDK flows or clock stamping. These are risks, not demonstrated production leaks.

## Required device profiling

On representative release builds, collect startup marks, screen commits, memory after repeated navigation/tenant switches, frame traces, background wakeups and SQLite/native journal timings. Exercise large histories and delayed network recovery. Use the same devices/data and OS conditions before/after; do not infer physical-device savings from the mocked counts above. Physical geofence/locked/force-quit behavior and network restoration remain separate correctness gates.

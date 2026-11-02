# Android background worker verification — 2026-11-02

The [cold-worker evidence](cold-worker.json) was collected on a newly created disposable Android 15 / API 35 Google Play ARM64 emulator, `ClaudionBackgroundQA20261102`, serial `emulator-5570`. Existing AVDs and user app data were untouched. No production tenant was configured and no live attendance API was called.

## Completed cold-process test

1. Built and installed the current debug app with `./gradlew :app:assembleDebug`. The successful build executed 106 of 640 tasks in 2m 15s after downloading missing public Android dependencies. Initial offline resolution failed because the new WorkManager transitive lifecycle dependency was not cached; the subsequent online dependency resolution/build passed.
2. Opened the fresh signed-out app to load its real JavaScript from local Metro. A host-only CDP script delivered a delayed call to the actual `scheduleBackgroundSync()` bridge. Disabled emulator Wi-Fi and mobile data before native enqueue. The committed diagnostic journal contained `worker.scheduled` and no worker start while the default network was absent.
3. Backgrounded the app, invoked `adb shell am kill com.bazim.claudioncheckin`, and confirmed `pidof` returned no process. This was an OS-style background process kill, not force-stop.
4. Restored the emulator's network with the app unopened. Android started a new process (6102 → absent → 6602). The native worker started, the actual registered JavaScript task ran, Redux hydration completed, and the task explicitly reported `retryable:false`. WorkManager's persisted `WorkSpec.state` was 2 (`SUCCEEDED`).
5. The launcher remained the resumed Activity. No debugger/inspector was attached between process kill and worker completion. Evidence was read afterward through `run-as` from the bounded native diagnostic journal and WorkManager database; authentication storage was not exported.

The worker started at native timestamp `1793600342017` and completed at `1793600343590`, about 1.6 seconds later. This is an observation from one emulator run, not an Android timing guarantee.

This test establishes cold React-host/Headless JS execution, hydration, explicit task completion, durable scheduling, and network-restoration execution without an Activity launch. Because the sandbox was signed out and had no attendance receipt, it does **not** establish authenticated upload, geofence delivery, attendance timestamps, or server duplicate handling on a device.

## Automated validation

- Full Jest suite reported by the implementation run: 154 suites passed, 3201 tests passed, 13 TODO. The final command used `--runInBand --watchman=false --forceExit`; a preceding run passed assertions but retained the existing asynchronous shutdown warning.
- The two focused background runner/real SQLite scheduling suites run during this verification passed 24 tests. Later implementation checks expanded this coverage; see the final implementation results for the final focused count.
- Local synthetic QA backend contracts: seven tests passed. An initial sandboxed run could not bind localhost; the rerun with local socket access passed.
- ESLint: zero errors and 19 pre-existing warnings, as reported by the final implementation check.
- Production Android Metro export passed, as reported by the implementation check.

The existing October 30 emulator artifacts belong to earlier location-access work and are not worker test evidence.

## Authenticated runs and coalesced scheduling

[coalesced-e2e.json](coalesced-e2e.json) records a later run on the same disposable emulator, signed in to the local mock backend as the synthetic `QA-ANDROID-001` through the real Login UI. Crossings were real Play Services transitions driven by `adb emu geo fix`; the app process was killed with `am kill` before each one. Google Maps held a foreground location request, because without one this emulator's fused provider did not deliver injected fixes to geofencing. No production tenant, credential, or attendance data was involved.

| Run | Result |
| --- | --- |
| First design, server outage then recovery | **Defect reproduced.** An ENTER captured at 12:53:20, with network and server healthy, sat `BLOCKED` behind a pass in exponential backoff and was accepted at 12:57:12, 3 min 52 s later. |
| Background EXIT, app killed | Receiver-started process; accepted online 3 s after capture, original timestamp. No Activity created. |
| Offline EXIT → network restored | Pass stayed `ENQUEUED` without running for 90 s offline; accepted 7 s after restoration. |
| Offline ENTER, process killed → network restored | `SystemJobService` started a new process; accepted 7 s after restoration. |
| Three transitions while an older OUT retried | During the outage, a new ENTER got a pass within 4 s although the retry timer was 5 minutes out, and queued behind the OUT. After recovery the next EXIT's pass delivered OUT, IN, OUT in capture order 4 s after capture; the 15-minute retry timer was cancelled. |
| Release build | The worker and headless JS ran from the embedded bundle, and the retry timer fired. Requests failed only because release blocks the mock's cleartext `http://` tenant. The retained receipt was delivered with its original time after reinstalling the debug build. |

All 11 backend records alternate IN/OUT with unique names and the original crossing times. Twice, a registration repaired after package replacement produced an initial ENTER while already checked in; both were handled with no punch. Passes never overlapped.

Not established: Android 11 / One UI, Samsung battery controls, Doze/App Standby, swipe-away, force-stop, geofencing without another location client, an authenticated release-mode upload (needs an HTTPS tenant), and live Frappe behaviour. Android 11 / Samsung One UI 3.1, genuine Play Services background transitions, authenticated device upload, Doze, swipe-away, explicit force-stop, and a physical permission-revocation matrix remain separate checks.

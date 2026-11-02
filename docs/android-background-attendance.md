# Android background geofence attendance

This audit concerns the Samsung Galaxy A50 (SM-A505F/DS), Android 11 / One UI 3.1 report that attendance arrives in a batch when the app is reopened. The repository establishes an execution gap; it does not establish which transitions the reported handset actually delivered. No production handset journal, logcat export, or live attendance data was supplied or accessed.

## Root cause established by code

Before this change, Android could capture a transition with no React Native context, but nothing in that path started the JavaScript attendance processor. `GeofenceBroadcastReceiver.onReceive()` used `goAsync()` and `GeofenceCaptureQueue.execute()` to call `GeofenceStore.appendEvent()`, then emitted an in-process hint through `GeofenceEventBus.emit()`. A missing listener dropped only the hint: the native receipt remained durable.

The native journal is **committed SharedPreferences JSON**, under `expo_auto_attendance` / `event_journal_v1`. It is not SQLite. `GeofenceEventJournal.append()` assigns a stable `eventId` and monotonically increasing `sequence`; `GeofenceStore` uses synchronous `SharedPreferences.Editor.commit()` and refuses failed persistence. The event timestamp is the device time observed when the native receiver was invoked, not an independently measured physical boundary-crossing time.

JavaScript moves each receipt into the SQLite automatic-event ingress table through `ingestPendingNativeEvents()` in [AutoAttendanceEventProcessor.js](../services/offline/AutoAttendanceEventProcessor.js). It acknowledges the native copy only after `AutoAttendanceEventRepository.ingestNativeEvent()` commits. An interrupted acknowledgment is safe because insertion uses the stable event ID and does not overwrite an existing outcome.

`BackgroundSyncManager` previously used only JavaScript AppState, NetInfo, token, queue callbacks, and a foreground interval. Its old comment that a geofence relaunch already woke JavaScript was unsupported by the Android implementation: no Headless JS task, WorkManager worker, JobScheduler job, or Expo TaskManager/background-location task was registered for this module. Expo Location is used for permissions and location/recovery reads; it does not provide this native receiver with an upload runtime automatically.

Both `OfflineAttendanceBootstrap` and `DurableAutoAttendanceBootstrap` were mounted by `App.js` after resource initialization and `PersistGate`. Therefore, native-only process wakes could persist an event without processing it. NetInfo reconnection could trigger a drain only while the JavaScript listener existed. Reopening the application re-established the listeners and ingested the backlog, which is consistent with the report.

## Stage ownership and dependencies

Source entry points: [Android receiver](../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceBroadcastReceiver.kt), [native store](../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceStore.kt), [native journal](../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceEventJournal.kt), [durable bootstrap](../components/DurableAutoAttendanceBootstrap.jsx), and [existing queue synchronizer](../services/offline/AttendanceSyncService.js).

| Stage | Owner | Required context |
| --- | --- | --- |
| Eligibility and registration | Scoped feature settings, employee policy, `reconcileAutoAttendanceRegistration()`, `GeofenceManager.startMonitoring()` | Authenticated configuration, eligible tenant and employee, granted location access |
| OS transition delivery | Play Services geofencing PendingIntent → `GeofenceBroadcastReceiver` | Android/Play Services delivery and permissions; no UI or Redux |
| Durable native capture | `GeofenceCaptureQueue`, `GeofenceStore`, `GeofenceEventJournal` | Android process and private app storage; no JavaScript |
| SQLite ingress and native acknowledgment | `ingestPendingNativeEvents()`, `AutoAttendanceEventRepository` | React Native JavaScript and Expo SQLite; no screen or foreground location read |
| Attendance decision | `drainAutoAttendanceEvents()`, `performSessionTransition({ execute })`, `submitAutoAttendance()` | Hydrated scoped feature authority, persisted credentials/configuration/session, existing session lock |
| Online attempt / offline upload | Existing attendance API and `syncPendingAttendance()` | Current persisted tenant/employee/authentication; transport and reachable backend |
| Server confirmation | Existing named response and server-history verification | Positive acceptance evidence; local queue acceptance alone is not confirmation |
| Notification | Existing local-notification helper, after the transition result | JavaScript and OS notification permission; alert failure does not roll back attendance |

The Android background entry point added by this change initializes/reuses the application React host and awaits persisted Redux hydration directly. It does not mount `App`, `PersistGate`, navigation, or screens, request a foreground GPS fix, repair registration, or initiate a new authentication flow. Its authentication and capability checks still apply; opening a UI is no longer the execution trigger required to obtain them.

## Background execution added

Implementation: [WorkManager scheduler](../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/AttendanceSyncScheduler.kt), [headless worker](../modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/AttendanceSyncWorker.kt), and [JavaScript background task](../services/offline/AndroidAttendanceBackgroundTask.js).

`AttendanceSyncScheduler.schedule()` enqueues one-time WorkManager work named `claudion-attendance-sync` after successful native append, access-loss capture, or access-recovery capture. Boot/package replacement also asks for a pass, so receipts already acknowledged into SQLite are not dependent on a still-pending native journal entry. JavaScript queue admission schedules the same mechanism. All HTTP stays in the existing JavaScript services.

Each pass runs in the unique chain `claudion-attendance-sync`. Scheduling is coalesced on one serial executor: if the chain already holds a pass that has not started (`ENQUEUED` or `BLOCKED`), the request is dropped, because that pass scans after the capture that asked for it; otherwise one pass is appended with `APPEND_OR_REPLACE`, so a capture that lands while a pass is running gets exactly one follow-up, run after it and never beside it. The chain therefore holds at most one running and one waiting pass, and no two JavaScript passes run at once.

A pass never returns `Result.retry()`. An earlier revision did, and on the emulator a new ENTER captured with a healthy server and network waited 3 min 52 s for the parent's exponential backoff, because WorkManager keeps appended work `BLOCKED` until its prerequisite succeeds (the backoff caps at five hours). Retry is now a separate unique timer, `claudion-attendance-sync-retry`, run by `AttendanceSyncRetryWorker`: it starts no JavaScript and only asks for a pass, so replacing it with `REPLACE` can never cancel an upload. A pass that leaves actionable work arms it after 30 s, 1, 2, 5, then every 15 minutes (a persisted streak); a pass that leaves none cancels it and resets the streak. New captures never wait for that timer. Only an OS interruption reschedules a pass itself, with a linear 30-second backoff.

WorkManager 2.10.5 requests a network with `NET_CAPABILITY_INTERNET` on API 28 and above, including Android 11. It deliberately does not require Android's separate `VALIDATED` captive-portal probe; a private tenant reachable over a usable network must not be gated on that probe. Earlier Android versions use `NOT_REQUIRED` as the native fallback and rely on the existing JavaScript transport check and retry ladder. Android decides actual execution time: on the emulator a two-minute retry timer fired about 90 seconds late. Scheduling does not reset the repositories' own `nextAttemptAt`/claim leases or resubmit uncertain punches; a pass only attempts what those ladders say is due.

Platform references: Android documents [custom network request constraints](https://developer.android.com/reference/androidx/work/Constraints.Builder#setRequiredNetworkRequest(android.net.NetworkRequest,androidx.work.NetworkType)), [work constraints and retry policies](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work), and [background geofence delivery limits and registration recovery](https://developer.android.com/develop/sensors-and-location/location/geofencing). These APIs permit scheduled execution; they do not promise immediate attendance delivery.

Receiver capture scheduling and the asynchronous JavaScript scheduling bridge wait up to five seconds for the WorkManager enqueue transaction. A scheduling diagnostic is emitted after that durable transaction succeeds, rather than treating an enqueue call alone as proof. Scheduling failure retains the original native receipt; it never acknowledges or deletes attendance.

`AttendanceSyncWorker` uses the application's shared `ReactHost`, starts `ClaudionAttendanceSync` through `HeadlessJsTaskContext`, and waits for `completeBackgroundSync(runId, retry)`. A normal task finish, rejection, or timeout without that explicit completion is never interpreted as a successful drain. The native worker bounds its wait at 150 seconds and the Headless JS task at 140 seconds. `runAndroidAttendanceBackgroundSync()` uses a shorter 100-second JavaScript budget and guards scope boundaries after cancellation. This does not abort a request already dispatched; its existing durable claim and history reconciliation protect the uncertain result.

The runner is registered while `App.js` is evaluated, before any React root mounts. It ingests receipts, waits for valid persisted login/scope authority, refreshes tenant/employee policy when transport is present, drains the existing outbox, processes the existing automatic-event ingress, and drains newly queued work. It mirrors resulting session state, flushes Redux persistence before completion, and uses the existing checkout notification path without requesting notification permission in the background. The final retry decision is scoped to actionable work, rather than a count that includes terminal rejection or manual-review-only records. Rows `blocked` on `endpoint-missing` are also excluded: only a server deployment can deliver them, so they would otherwise arm the retry timer forever. They stay in SQLite, every pass that does run still attempts them when due, and they never hold newer rows back. A confirmed tenant/employee revocation stops monitoring; a missing policy or failed refresh retains monitoring and schedules policy recovery rather than treating failure as revocation. The native module skips registration repair and GPS recovery when created with an active worker and no Activity; a later actual foreground Activity performs deferred native restoration.

## Diagnostic evidence

Development builds emit structured lifecycle diagnostics correlated by the native event UUID; worker lifecycle also records its WorkManager run UUID. A diagnostic journal in private SharedPreferences `attendance_background_diagnostics` / `entries` retains at most 200 entries for seven days. It is separate from the unbounded-until-acknowledged attendance receipt journal: diagnostic pruning cannot delete attendance.

`getBackgroundSyncDiagnostics()` exposes the bounded journal in a debuggable build and returns an empty array otherwise. Entries retain allowlisted stage/status labels, numeric timings/counts/queue IDs/HTTP status, and booleans. They omit tenant addresses, employee identity, coordinates, headers, credentials, payloads, server document names, and raw exception text. Diagnostic persistence failure never changes capture or synchronization behavior. Do not export the general AsyncStorage database or token store when collecting a report.

Use receiver/capture/persistence stages to establish native detection; ingress and queue stages to establish SQLite ownership; scheduled/start/complete/retry stages to establish execution; and network/reachability/upload/HTTP stages to establish the request outcome. AppState/startup diagnostics establish whether processing preceded or followed a foreground launch. Console-only details do not survive process death, so use the bounded journal when comparing native-only receipt with later processing.

## Historical receipts versus startup behavior

`DurableAutoAttendanceBootstrap` ingests and drains native receipts on startup/foreground and native delivery. It also refreshes configuration, checks access recovery, and reconciles registration. Initial registration can cause Play Services `INITIAL_TRIGGER_ENTER` at the current time. That is a new native observation and cannot prove when an employee previously arrived.

The legacy bootstrap's `reconcilePresence()` may restore an already-open server session. The current implementation explicitly declines to create a check-in from a current location fix alone. The new headless path performs no current-location reconciliation. Existing access-loss and fresh-fix recovery receipts remain distinct from ENTER/EXIT events and retain their own reason and timestamp.

Historical processing preserves `event.timestamp` → ingress `occurredAt` → session transition `at` and saved `punchTimestamp`. The existing server-clock conversion accounts for the event's age; replay never substitutes app-opening time for captured time. Android may delay the original callback, so this preserves native observation time rather than claiming an exact physical crossing time.

To distinguish a detection failure from a synchronization failure on a test handset, collect evidence **before reopening**:

1. Match the receiver diagnostic and native `eventId` / `timestamp` to the unacknowledged native journal. Their presence proves native receipt, even if no SQLite row exists yet.
2. Match the same ID to SQLite ingress, acknowledgment, worker execution, queue row ID/status, and upload/verification diagnostics. A native receipt with no worker execution points to scheduling; a running worker with pending/retry records points to processing, network, authentication, configuration, or server availability.
3. Compare original ingress/native times with registration/startup times. A newly captured initial ENTER after registration is different evidence from a historical receipt that predates reopening.
4. A backend record alone cannot prove which of these paths created it: the existing API payload does not send the native UUID. Correlate the locally saved punch timestamp and type with server evidence without changing the backend contract.

## Ordering, uncertainty, and eligibility

The worker invokes the existing processors rather than introducing an independent uploader. Automatic-event sequencing, SQLite claims and leases, session transition locking, queued IN/OUT pairing, and one-record-per-request offline uploads remain authoritative. If the process dies after dispatch, `onlineAttemptAt` / `uploadAttemptAt` retains evidence: a subsequent run verifies server history instead of blindly sending the same request again. A timeout therefore cannot establish exactly-once server delivery, and ambiguous records may need review.

`AutoAttendanceEventRepository.hasEarlierUnresolvedEvent()` deliberately holds later records for the same tenant/employee behind uncertain earlier attendance. Invalid, unattributable, stale, or mismatched native captures are explicitly exempted from that hold. Do not bypass an uncertain attendance record merely to make later rows move; it could produce an OUT before its IN or duplicate a server-accepted punch. Records for other tenants/employees are never claimed under the current identity.

Tenant `attendance_action.geo_tagging` must be the boolean `true`; false, zero, missing, or unknown does not authorize automatic attendance. Scoped employee mode 2 authorizes automatic punches; modes 0 and 1 do not. Mode 1 remains warnings-only and is not newly monitored. Existing assigned geometry, offline policy/capability, access-loss generation checks, and server verification govern the headless path as they govern foreground processing. Disabling future queue admission does not delete already accepted attendance. Logout retains records and does not grant permission to upload them under a new account.

## Android and Samsung limits

- A new Android native build is required. An OTA update cannot add WorkManager or the native worker; bridge additions tolerate older binaries by remaining optional. This change does not add a foreground service, permanent polling, or an iOS background worker.
- Existing fine/coarse and background location permissions remain required for geofence capture. Android 11's background location grant is a separate user choice; the worker does not request it or silently enable location. Notification permission affects the alert, not server acceptance.
- The module manifest adds the normal `ACCESS_NETWORK_STATE` and `WAKE_LOCK` permissions for scheduled execution. They introduce no runtime permission dialog. WorkManager contributes its supported scheduling components through manifest merging; no custom foreground service or battery-exemption permission is added.
- WorkManager network constraints and retries permit eventual work after connectivity returns. They do not guarantee immediate execution. Doze, App Standby, OEM restrictions, process pressure, reboot/unlock state, and a reachable network without a reachable tenant may delay delivery or synchronization. API 28+ scheduling accepts an INTERNET-capable network without requiring its VALIDATED probe; the app still verifies transport and tenant reachability through the existing services.
- Swiping from Recents is distinct from OS process death and explicit force-stop. Actual Samsung behavior needs a physical-device test. Explicit force-stop prevents normal scheduled/background delivery until Android allows the app to run again, generally after a user launch. Do not represent force-stop as recoverable merely by waiting online.
- Check Samsung's per-app battery/background controls, Sleeping apps / Deep sleeping apps, and location settings on the affected handset. Settings vary by One UI version. No battery exemption is silently requested or required as a substitute for implementing background scheduling; document the actual settings used during device validation.
- Reboot/package-replacement restoration remains permission-aware and uses the persisted registration. No worker can recover a crossing that Android never delivered. Missed historical times must not be invented from a later GPS fix.

## Validation and release gate

Repository tests and native compilation validate specific contracts; they cannot establish Play Services delivery on a Galaxy A50. The existing `docs/testing/location-access-emulator-2026-10-30` evidence predates this change and used Android 15 / API 35. It is not evidence that this worker runs on Android 11 or One UI 3.1.

The host has `adb`, the Android emulator, and Kotlin tooling. An initial sandboxed `adb devices -l` could not start its local listener (`Operation not permitted`); no handset test was inferred from that failure. Existing personal AVDs must remain untouched. Use a new disposable emulator/sandbox and the synthetic [local QA backend](../test-utils/locationAccessQa/README.md); never provision it with a production tenant. Do not run live attendance API tests without explicit authorization.

| Scenario | Evidence required | Status for this change |
| --- | --- | --- |
| App open, enter | Native ID → ingress → accepted IN | **Emulator pass**; physical pending |
| Background EXIT and ENTER | Native captures plus scheduled/running work while UI stays backgrounded | **Emulator pass**; physical pending |
| OS-killed process | Cold React-host start, headless completion, server acceptance without Activity launch | **Emulator pass** (`am kill`, receiver- and job-started processes); physical pending |
| Swipe from Recents | Actual Android 11/Samsung capture and worker result | Physical Samsung pending |
| Offline EXIT | Durable native receipt before restoring network/opening app | **Emulator pass**; physical pending |
| Restore internet, app unopened | Network-constrained worker runs; accepted original timestamp | **Emulator pass**, warm and cold process; physical pending |
| Multiple transitions while an older record retries | Ordered native sequences, SQLite claims, paired original IN/OUT times, no wait behind retry delay | **Emulator pass**; physical pending |
| POST accepted then connection drops / times out | One backend record; retry performs history verification, no blind POST | Mock/device execution pending |
| Reopen with pending work | Same stable IDs; no duplicate server record | Device execution pending |
| Doze / App Standby | Capture/delivery/work latency observed, including delayed scheduling | Device execution pending |
| Explicit force-stop | Document suppressed work and recovery only when permitted | OS limitation; device execution pending |
| Location revoked | Existing access-loss safeguards, preserved receipts, no unauthorized recovery | Regression/device execution pending |
| Tenant false / employee 0 or 1 | No new automatic punch | Automated/device validation pending |

For safe emulator validation, use only the disposable local backend's real app endpoints and fault controls. It supports scoped synthetic employees, one-record offline requests, `accept_disconnect`, and `accept_timeout`; its stored timestamps and request log can establish local duplicate avoidance. Keep the backend fault controls and all host-side inspection scripts outside the app bundle. `adb shell am kill PACKAGE` simulates a background process kill more closely than `am force-stop`; record which command was used, process IDs, Activity state, OS version, network state, and work IDs. Confirm delivery with the app unopened before attaching a debugger or running an inspection command that might initialize React Native.

Authenticated emulator results, including the before/after comparison for coalesced scheduling, are in [the 2026-11-02 worker evidence](testing/android-background-2026-11-02/README.md). Android 11 / One UI 3.1 rollout remains conditional on the physical-device lifecycle/network matrix and authorized staging compatibility checks.

# Testing and validation

> Historical baseline at `de722c9`. Read [11-RELIABILITY-FIXES.md](11-RELIABILITY-FIXES.md) for the current fixes, regression results, native-build limits and physical-device validation plan. Source line anchors below refer to the baseline.

## What was and was not validated

This was a static, read-only application investigation. Imports/call sites, event handlers, native stores/receivers/delegates, queue SQL/migrations, authentication guards, config/plugin inputs, and test assertions were inspected. Documentation paths/line anchors and deliverable names were checked. The iOS runtime template matched the committed runtime byte-for-byte. Only `docs/auto-attendance-context/` was written.

**No application test command, npm installation, Metro bundle, Expo prebuild, native build, device run, API call, commit, or push was performed.** No suite is reported as passing. Existing SDK documents may record earlier runs; those results are supporting historical context, not validation of this checkout by this investigation. Coverage here means assertions found, not measured execution coverage.

## Existing behavioral suites

| Contract | Suites and assertions visible in source |
| --- | --- |
| Bootstrap ENTER/EXIT/session | [AutoAttendanceBootstrap.checkout.test.jsx](../../__tests__/AutoAttendanceBootstrap.checkout.test.jsx): manual session → auto OUT, redundant transitions, failure state, replay/listeners, warnings-only, queue direction, notifications. |
| Initial/presence recovery | [AutoAttendanceBootstrap.presence.test.jsx:198](../../__tests__/AutoAttendanceBootstrap.presence.test.jsx#L198): inside/outside, existing monitor, already-open session, replay timestamp, no presence mark, overlapping startup, permission sync request, queue/auth recovery, server-open/unavailable status, endpoint-block exclusions, count failure. |
| Policy/UI | [autoAttendanceSlice.test.js:17](../../__tests__/autoAttendanceSlice.test.js#L17), [autoAttendanceUi.test.jsx](../../__tests__/autoAttendanceUi.test.jsx): normalization, opt-in, logout reset, sync request; modern/legacy screen wiring, unavailable/dev UI, themed mocked hook states. |
| Automatic API / clock | [autoCheckInOut.test.js](../../__tests__/autoCheckInOut.test.js), [serverClock.test.js](../../__tests__/serverClock.test.js): payload `auto`, timestamp adjustment, office metadata, no repeated manual location restriction, offset formatting. |
| Replay | [geofenceEventLog.test.js](../../__tests__/geofenceEventLog.test.js): transition mapping, old/future/processed events, sequential mark updates. This does not prove atomic concurrent mark writes. |
| Cached policy / GPS | [attendanceConfigCache.test.js](../../__tests__/attendanceConfigCache.test.js), [offlineGateGeofence.test.js](../../__tests__/offlineGateGeofence.test.js), [resolveNearestOffice.test.js](../../__tests__/resolveNearestOffice.test.js): policy caching/normalization, automatic non-radius admission, manual constraints, fallback office resolution. |
| Queue and migrations | [attendanceQueueRepository.test.js](../../__tests__/attendanceQueueRepository.test.js), [attendanceQueueMigration.test.js:86](../../__tests__/attendanceQueueMigration.test.js#L86), [attendanceQueueService.test.js](../../__tests__/attendanceQueueService.test.js): SQL insertion/claim/order, status/pairing, v1–v4 upgrades/rollback, manual online-only versus automatic fallback. |
| Bulk API / classification / capability | [attendanceOfflineApi.test.js](../../__tests__/attendanceOfflineApi.test.js), [offlineAttendanceErrors.test.js](../../__tests__/offlineAttendanceErrors.test.js), [offlineCapability.test.js](../../__tests__/offlineCapability.test.js): one-record payload, response wrapper/result parsing, recoverable versus validation failures, endpoint/admin admission state. |
| Drains/recovery | [attendanceSyncService.test.js](../../__tests__/attendanceSyncService.test.js), [offlineQueueRecovery.test.js](../../__tests__/offlineQueueRecovery.test.js), [offlineStrandedQueue.test.js](../../__tests__/offlineStrandedQueue.test.js), [attendanceRecovery.test.jsx:97](../../__tests__/attendanceRecovery.test.jsx#L97): scoped queue recovery, claim serialization, backoff, duplicate verification, retained data, uncertain acceptance, account switch, recovery UI. |
| Scope/refresh/expiry | [attendanceRequestScope.test.js:27](../../__tests__/attendanceRequestScope.test.js#L27), [attendanceAuthRecovery.integration.test.js](../../__tests__/attendanceAuthRecovery.integration.test.js), [attendanceExpiryRecovery.test.js](../../__tests__/attendanceExpiryRecovery.test.js), [apiClient.test.js](../../__tests__/apiClient.test.js), [sessionResilience.test.js](../../__tests__/sessionResilience.test.js): current credentials, scope across refresh, logout/switch, ordinary 401/403, transient refresh and retained queue. |
| Session/manual interoperability | [attendanceSessionState.test.js](../../__tests__/attendanceSessionState.test.js), [attendanceSessionAuthority.test.js](../../__tests__/attendanceSessionAuthority.test.js), [attendanceStatusUnavailable.test.js](../../__tests__/attendanceStatusUnavailable.test.js), [AttendanceAction.session-timer.test.jsx](../../__tests__/AttendanceAction.session-timer.test.jsx), [AttendanceAction.break-rules.test.jsx](../../__tests__/AttendanceAction.break-rules.test.jsx): locking, local authority, timer restoration, unknown status and manual rules. |
| Presentation/correction | [attendanceHistoryMerge.test.js](../../__tests__/attendanceHistoryMerge.test.js), [attendanceHistory.test.js](../../__tests__/attendanceHistory.test.js), [attendanceHistoryUi.test.jsx](../../__tests__/attendanceHistoryUi.test.jsx), [attendanceHistoryRefresh.test.jsx](../../__tests__/attendanceHistoryRefresh.test.jsx), [attendanceRequestUi.test.jsx](../../__tests__/attendanceRequestUi.test.jsx), [offlineStatus.test.js](../../__tests__/offlineStatus.test.js), [offlineBannerUi.test.jsx](../../__tests__/offlineBannerUi.test.jsx): merged rows, sync status, recovery/correction, offline-alert copy. |
| Native/config integration | [attendanceScenePlugin.test.js:12](../../__tests__/attendanceScenePlugin.test.js#L12), [nativeConfiguration.test.js:16](../../__tests__/nativeConfiguration.test.js#L16), [otaUpdate.test.js](../../__tests__/otaUpdate.test.js): plugin reapplication/refusal, scene/runtime inputs, template consistency, permission/subscriber declarations, update configuration. These are JS/text/config checks, not Kotlin/Swift execution. |
| Adjacent integrations | [localNotifications.test.js](../../__tests__/localNotifications.test.js), [fcm.service.logout.test.js](../../__tests__/fcm.service.logout.test.js), [featureSettings.test.jsx](../../__tests__/featureSettings.test.jsx), [featureLabels.test.js](../../__tests__/featureLabels.test.js), [authProvisioning.test.jsx](../../__tests__/authProvisioning.test.jsx), [mobileAuthSession.test.js](../../__tests__/mobileAuthSession.test.js): notification permissions, session cleanup, feature visibility, provisioning/handoff. |

Two pre-existing **untracked** suites are particularly relevant and were left untouched:

- [autoAttendance.characterization.test.jsx:233](../../__tests__/autoAttendance.characterization.test.jsx#L233) describes current single-slot replay, current-scope live events, NULL-scope historical replay, manual-OUT presence reopen, old fence retention, employee/tenant/global-mark behavior, refresh expiry, duplicate ENTER, late/out-of-order events, and future SDK `.todo` contracts.
- [autoAttendanceQueueProvenance.test.js:166](../../__tests__/autoAttendanceQueueProvenance.test.js#L166) exercises real SQL with mocked transport: NULL-tenant dependency stalls, known origin scope, online OUT bypass, online/bulk source metadata difference, scoped logout/tenant changes, FIFO/pairing, same-second dedupe, verified/inconclusive duplicates, and process-restart claims. Desired future cases remain TODOs.

These suites are evidence of specified assertions, not proof that the assertions currently pass or that mocked OS behavior occurs on hardware.

## Test environment and proposed commands

Jest uses `jest-expo`, React Native Testing Library, shared mocks in `jest.setup.js`, and package-specific ESM transforms/entry mappings. Queue integration suites use `@jest-environment jsdom` with `test-utils/expoSqliteMock.js` backed by sql.js. They do not use a device's SQLite/native scheduler. `.git-rewrite/` is excluded from Jest. [jest.config.js:1](../../jest.config.js#L1), [jest.setup.js:1](../../jest.setup.js#L1), [SQLite mock:1](../../test-utils/expoSqliteMock.js#L1).

The following are **future validation commands**, not commands executed for this report. Run from repository root only in an authorized implementation/validation task:

```sh
npm test -- __tests__/AutoAttendanceBootstrap.checkout.test.jsx __tests__/AutoAttendanceBootstrap.presence.test.jsx __tests__/autoCheckInOut.test.js __tests__/geofenceEventLog.test.js --runInBand --watchman=false
npm test -- __tests__/attendanceQueueMigration.test.js __tests__/attendanceQueueRepository.test.js __tests__/attendanceQueueService.test.js __tests__/attendanceOfflineApi.test.js __tests__/attendanceSyncService.test.js __tests__/attendanceRequestScope.test.js __tests__/attendanceRecovery.test.jsx --runInBand --watchman=false
npm test -- __tests__/attendanceScenePlugin.test.js __tests__/nativeConfiguration.test.js --runInBand --watchman=false
npm test -- __tests__/autoAttendance.characterization.test.jsx __tests__/autoAttendanceQueueProvenance.test.js --runInBand --watchman=false
npm test -- --runInBand --watchman=false
```

Use focused suites for isolated changes and the full suite for shared service/state changes. No checked-in lint configuration, TypeScript project/typecheck script, or CI workflow establishes another passing check; installed TypeScript alone is not a typecheck. `npm run lint` currently lacks repository ESLint configuration. [package.json:5](../../package.json#L5), [AGENTS.md:24](../../AGENTS.md#L24).

## Validation gaps and device scenarios

No native module unit tests for actual Play Services/Core Location callbacks were found. Prioritize physical-device experiments with matching binaries, disposable staging employee accounts, and captured sanitized observations:

| Scenario | Required observation |
| --- | --- |
| Inside registration, outside registration, repeated boundary movement | Native stored event, live JS event, local session, actual Employee Checkin, source metadata, duplicate behavior. Record callback delay separately from physical crossing time. |
| ENTER and EXIT while JS absent | Determine which OS callbacks occurred, which event survived, whether iOS root woke, and whether Android waits for app reopen. Do not equate one surviving event with complete attendance. |
| Ordinary process death versus explicit force-stop/force-quit | Test separately; establish actual OS behavior, background-refresh/power settings, and reopen results. |
| Android reboot/package replacement / Play Services unavailable | Confirm receiver invocation, async registration completion, native/OS monitoring agreement, subsequent transitions. |
| iOS region wake / Firebase wake with no scene | Verify subscriber priming, one background root, selected Updates bundle, hydration, permission/GPS behavior, expiration, and later scene reuse. DEBUG startup probe tests root mechanics only. |
| Permission denied, Always downgraded, approximate location, restored grants | Observe warning/error paths and whether monitoring is stopped/repaired or remains only a stored flag. |
| GPS disabled, indoor no fix, low power, battery optimization, Background App Refresh disabled | Observe registration, callback delivery, startup latency, queue admission, and whether app work finishes. |
| Network down then restored, captive/filtered network probe | Verify transport predicate, online attempt/failure, retained queue, scoped drain and server result. |
| Server commit followed by lost response / duplicate / contradictory success | Confirm exact history verification; uncertain outcomes must stay visible and must not auto-resend. |
| Manual IN → auto OUT; queued IN → online EXIT; manual OUT while inside then restart | Compare device session and server ordering; exercise replay and presence guards explicitly. |
| Logout/login/employee change/same-code tenant change during awaits | Confirm retained rows, no wrong-scope claim/request, session-owner behavior, global event-mark/fence state, opt-in reset. |
| Device clock/timezone change, old server offset, same-second events | Check timestamps, replay age, uniqueness, FIFO and exact verification across server formatting. |
| New binary/old OTA, old binary/new OTA | Verify optional-native behavior, method fallbacks, runtime/channel compatibility and committed iOS settings. |

Live tenant rollout also needs both sign-in methods, OTP-only/recovery where enabled, backend employee mapping, explicit mobile attendance flags/locations, refresh tokens, ordinary and offline endpoint contracts, and history timestamps. These remain open even if Jest or native builds pass. [docs/mobile-sign-in.md](../mobile-sign-in.md).

Record device/OS/build/runtime/channel, relevant permission/power/network conditions, sanitized transition timestamps, local status/queue outcome, and actual server record identifiers in an appropriately controlled test record. Never collect passwords, OTPs, refresh/access tokens, production employee data, or lookup secrets in these context documents.

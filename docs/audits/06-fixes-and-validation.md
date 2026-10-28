# Fixes, validation and remaining work

Date: 2026-10-28. Baseline `9e163f4c0c785253b4360a9c2d50ca1405695816`; initial Git status clean. The audit proceeded through installed-skill discovery, architecture/baseline review, evidence-based prioritization, local remediation, regression/bundle/native checks and these six reports.

Reports: [skill inventory](01-skill-inventory.md), [architecture](02-architecture-audit.md), [performance and memory](03-performance-memory-audit.md), [UI and motion](04-ui-ux-animation-audit.md), [security and reliability](05-security-reliability-audit.md), and this fixes/validation ledger.

## Findings ledger

Severity counts distinguish app/code findings from the registry's package-level advisory counts. **14 findings: 0 Critical, 4 High, 9 Medium, 1 Low. 13 fixed; F14 remains open.** Suspected/device-only risks and hook warnings are not counted as confirmed bugs.

| ID | Severity / state | Affected location and cause | Fix / regression evidence |
| --- | --- | --- | --- |
| F01 | High / fixed | App singleton query cache outlives authentication generation | services/queryClient.js + authSessionGuard invalidation listener; real QueryClient cache/race/retry/rotation tests |
| F02 | High / fixed | apiClient unconditionally attached tenant bearer to foreign absolute destinations; context/retry could cross generation | Effective Axios destination and generation guard; apiClient, capabilityTransport, provenance regressions |
| F03 | High / fixed | FCM tokens, profile/location, notification/upload payloads entered logs | Token redaction and metadata-only diagnostics; FCM, manualLocationTransport and refresh log regressions |
| F04 | Medium / fixed | Shared/copied skeleton loops ignored reduced motion | One shared reduced-motion-aware pulse; motionLifecycle |
| F05 | Medium / fixed | Retained Welcome loops continue behind pushed routes/inactive app | Focus/AppState gate all six decorative loops; motionLifecycle |
| F06 | Medium / fixed | Foreground periodic sync/replay callbacks run during runnable background periods | Gate only periodic callbacks; backgroundSyncLifecycle and durable-bootstrap SQLite lifecycle test |
| F07 | Medium / fixed | Optional haptics discarded native rejections/throws | Best-effort error handling with unchanged undefined return; hapticsMessage |
| F08 | Medium / fixed | Settled GPS races retain losing 8s/12s timeout | finally clears deadlines, same fallback; locationTimeoutCleanup |
| F09 | Medium / fixed | Notification successful empty indistinguishable from failed [] | Strict opt-in service mode and scoped error/refresh state; notificationReadState, notificationsUi |
| F10 | Medium / fixed | Shortcut1/2 fetch errors rendered normal empty state | Scoped error/retry and distinct shared modern/classic feedback; shortcutData/details UI |
| F11 | Medium / fixed | npm lint cannot run without configuration | .eslintrc.cjs correctness/hooks configuration; documented exceptions and visible warnings; AGENTS updated |
| F12 | Medium / fixed | Crash diagnostic fingerprint Set grows without bound | Latest 128 distinct fingerprints; cache capacity/eviction behavior test |
| F13 | Low / fixed | Presence regression assigned undeclared mockAwaitingServerCount rather than mockQueueCounts | Correct fixture now sets both expected counts; presence suite and no-undef lint |
| F14 | High / open | Locked dependency tree has current registry advisories | Report 05 inventories packages/paths; unsafe downgrade/major native changes avoided; compatible vendor patch review remains |

Each finding's root cause, user/system impact, principle/skill, minimal fix and regression are expanded in reports 02–05. General engineering principles cover authentication isolation, diagnostic data minimization, resource ownership and explicit failure states where no installed design skill governs the domain.

## Baseline and final checks

Baseline: **131 Jest suites / 2,943 passing tests / 13 TODOs / zero failed assertions**. Baseline `npm run lint` exited 2 (no config); `tsc --noEmit` exited 1 (no tsconfig, printed help). No TypeScript check is claimed.

| Final check | Result / exact command or artifact |
| --- | --- |
| Full Jest | **138 suites, 3,010 tests passed; 13 TODOs; zero failed assertions.** `npm test -- --runInBand --watchman=false --silent --forceExit --json --outputFile=/private/tmp/claudion-audit-final-jest.json`; log `/private/tmp/claudion-audit-final-jest.log` |
| ESLint | `npm run lint`: exit 0, **0 errors / 16 warnings**; `/private/tmp/claudion-audit-lint.log`. Exceptions for existing intentional/style idioms are explicit in `.eslintrc.cjs`; exhaustive-deps warnings remain visible. |
| TypeScript | Not configured; baseline compiler command exited 1 with help, no type-check result claimed. |
| iOS + Android Metro export | Passed: `CI=1 node node_modules/expo/bin/cli export --platform ios --platform android --output-dir /private/tmp/claudion-audit-final-export --no-bytecode --max-workers 2`; log `/private/tmp/claudion-audit-final-export.log`. Local production JS bundles, not a deployment or native build. |
| Swift native store | 59 persistence checks passed against production GeofenceStore.swift. |
| Kotlin journal | Production journal source compiles with installed kotlinc. Full store harness unavailable without JSON-java. |
| Static source syntax | Installed Babel parser parsed every tracked app JS/JSX source: no errors. |
| Diff formatting | `git diff --check`: passed. |
| Production/live/device tests | Not performed. All new network/attendance assertions use controlled mocks and isolated SQLite fixtures. |

Compared with baseline, the suite contains **7 additional suites and 67 additional passing tests**. Existing TODOs remain TODOs.


The full suite includes manual/automatic attendance, manual IN/automatic OUT, scoped capability/geotagging, SQLite migrations/ordering/claims, outage preflight, ambiguous POST, session/auth recovery, QR/mobile flows, UI themes and new lifecycle/error/privacy regressions. The first integrated run caught an error-code priority mismatch in the new transport guard; source was corrected to preserve the existing capability contract before the final run. Failed intermediate runs are not counted as final passes.

Jest uses `--forceExit`, as the existing baseline required for whole-suite completion. Passing assertions do not establish elimination of all Jest open handles. The new GPS cleanup tests prove only their specific deadlines are cleared. Lint now executes, with no errors and visible pre-existing hook-dependency warnings; this is not a zero-warning cleanup. No broad dependency/style/type migration was undertaken.

Native checks use installed tools against production source and existing fixtures:

```sh
xcrun swiftc -module-cache-path /private/tmp/claudion-native-audit-swift-cache modules/expo-auto-attendance/ios/GeofenceStore.swift native-tests/ios/GeofenceStoreTests.swift -o /private/tmp/claudion-native-audit-geofence-store-tests
/private/tmp/claudion-native-audit-geofence-store-tests
kotlinc modules/expo-auto-attendance/android/src/main/java/expo/modules/autoattendance/GeofenceEventJournal.kt -d /private/tmp/claudion-native-audit-geofence-journal.jar
```

Swift store harness: **59 persistence checks passed**. Kotlin journal: compilation passed. These are not full native app builds or physical Core Location/Play Services tests. The Android full journal/store harness was not run because JSON-java is absent; no new third-party jar was downloaded/executed. Committed/template iOS background runtimes match byte-for-byte.

## Performance and memory outcome

Implemented resource reductions: suppress six invisible Welcome loops; suppress reduced-motion skeleton loops; avoid inactive periodic work; release settled GPS deadlines; bound diagnostic fingerprint retention; release prior-session HR query cache. Shared skeleton logic removes three copied loop bodies. No speculative memoization or native monitoring reduction was added.

Before evidence and deterministic after counts are in report 03. **No measured startup, screen time, heap bytes, CPU, battery percentage, DB latency or FPS improvement is claimed.** Release/profile builds on representative physical devices remain required for those measurements.

## Remaining verification

1. Review compatible dependency patches/vendor releases and the two critical package advisories' actual runtime/tooling exposure; rerun audit and compatibility checks after lock changes.
2. Validate both authentication methods, SDK employee mapping and refresh-token compatibility on disposable staging accounts.
3. Verify offline/online geofence capture and recovery on physical iPhone/Android across background, locked, first unlock, process death, reboot and OEM restrictions. No live firewall or attendance writes were performed in this audit.
4. Run release-device performance/accessibility/layout passes: text scaling/Arabic, keyboard reachability, screen readers, dark/light, animation interruption and retained memory.
5. Review the 16 existing hook dependency warnings individually; avoid adding unstable dependencies that change attendance semantics merely to silence lint.

No commit, push, deployment, production configuration change, live application database access or production attendance record mutation was performed. Changes remain local and reviewable. The previous Simulator test's limited approval was not reused for new production tests.

## Modified files

Total changed/new files: **57**. The list includes this report and all other audit deliverables.

- [.eslintrc.cjs](../../.eslintrc.cjs)
- [AGENTS.md](../../AGENTS.md)
- [App.js](../../App.js)
- [CLAUDE.md](../../CLAUDE.md)
- [__tests__/AutoAttendanceBootstrap.presence.test.jsx](../../__tests__/AutoAttendanceBootstrap.presence.test.jsx)
- [__tests__/apiClient.test.js](../../__tests__/apiClient.test.js)
- [__tests__/autoAttendanceBootstrap.durable.test.jsx](../../__tests__/autoAttendanceBootstrap.durable.test.jsx)
- [__tests__/backgroundSyncLifecycle.test.js](../../__tests__/backgroundSyncLifecycle.test.js)
- [__tests__/crashlytics.service.test.js](../../__tests__/crashlytics.service.test.js)
- [__tests__/fcm.service.notifications.test.js](../../__tests__/fcm.service.notifications.test.js)
- [__tests__/hapticsMessage.test.js](../../__tests__/hapticsMessage.test.js)
- [__tests__/locationTimeoutCleanup.test.js](../../__tests__/locationTimeoutCleanup.test.js)
- [__tests__/manualLocationTransport.test.js](../../__tests__/manualLocationTransport.test.js)
- [__tests__/motionLifecycle.test.jsx](../../__tests__/motionLifecycle.test.jsx)
- [__tests__/notificationReadState.test.js](../../__tests__/notificationReadState.test.js)
- [__tests__/notificationsUi.test.jsx](../../__tests__/notificationsUi.test.jsx)
- [__tests__/queryClientSession.test.js](../../__tests__/queryClientSession.test.js)
- [__tests__/shortcutData.test.js](../../__tests__/shortcutData.test.js)
- [__tests__/shortcutDetailsUi.test.jsx](../../__tests__/shortcutDetailsUi.test.jsx)
- [__tests__/welcomeUi.test.jsx](../../__tests__/welcomeUi.test.jsx)
- [components/AttendanceHistory/HistorySkeleton.jsx](../../components/AttendanceHistory/HistorySkeleton.jsx)
- [components/DurableAutoAttendanceBootstrap.jsx](../../components/DurableAutoAttendanceBootstrap.jsx)
- [components/ExpenseClaim/ExpenseSkeleton.jsx](../../components/ExpenseClaim/ExpenseSkeleton.jsx)
- [components/ShortcutDetails/DetailSkeleton.jsx](../../components/ShortcutDetails/DetailSkeleton.jsx)
- [components/ShortcutDetails/ShortcutDetailsLegacy.js](../../components/ShortcutDetails/ShortcutDetailsLegacy.js)
- [components/ShortcutDetails/ShortcutDetailsModern.jsx](../../components/ShortcutDetails/ShortcutDetailsModern.jsx)
- [components/Welcome/AccentHalo.jsx](../../components/Welcome/AccentHalo.jsx)
- [components/Welcome/ShimmerField.jsx](../../components/Welcome/ShimmerField.jsx)
- [components/common/Skeleton.jsx](../../components/common/Skeleton.jsx)
- [docs/audits/01-skill-inventory.md](../../docs/audits/01-skill-inventory.md)
- [docs/audits/02-architecture-audit.md](../../docs/audits/02-architecture-audit.md)
- [docs/audits/03-performance-memory-audit.md](../../docs/audits/03-performance-memory-audit.md)
- [docs/audits/04-ui-ux-animation-audit.md](../../docs/audits/04-ui-ux-animation-audit.md)
- [docs/audits/05-security-reliability-audit.md](../../docs/audits/05-security-reliability-audit.md)
- [docs/audits/06-fixes-and-validation.md](../../docs/audits/06-fixes-and-validation.md)
- [hooks/useNotifications.js](../../hooks/useNotifications.js)
- [hooks/useReducedMotion.js](../../hooks/useReducedMotion.js)
- [hooks/useShortcutData.js](../../hooks/useShortcutData.js)
- [screens/Notifications.jsx](../../screens/Notifications.jsx)
- [screens/Shortcut1.jsx](../../screens/Shortcut1.jsx)
- [screens/Shortcut2.jsx](../../screens/Shortcut2.jsx)
- [screens/WelcomeScreenModern.jsx](../../screens/WelcomeScreenModern.jsx)
- [services/api/apiClient.js](../../services/api/apiClient.js)
- [services/api/attendance.service.js](../../services/api/attendance.service.js)
- [services/api/complaint.service.js](../../services/api/complaint.service.js)
- [services/api/employee.service.js](../../services/api/employee.service.js)
- [services/api/leave.service.js](../../services/api/leave.service.js)
- [services/api/notification.service.js](../../services/api/notification.service.js)
- [services/crashlytics.service.js](../../services/crashlytics.service.js)
- [services/notifications/fcm.service.js](../../services/notifications/fcm.service.js)
- [services/offline/BackgroundSyncManager.js](../../services/offline/BackgroundSyncManager.js)
- [services/offline/offlineAttendanceGate.js](../../services/offline/offlineAttendanceGate.js)
- [services/queryClient.js](../../services/queryClient.js)
- [utils/HapticsMessage.js](../../utils/HapticsMessage.js)
- [utils/authSessionGuard.js](../../utils/authSessionGuard.js)
- [utils/autoAttendance.js](../../utils/autoAttendance.js)
- [utils/httpDiagnostics.js](../../utils/httpDiagnostics.js)


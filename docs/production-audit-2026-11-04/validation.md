# Validation report

Audit baseline: `fa3ed0352d13fe3c26a24978f30453a899d11c7d`, clean working tree. Commands run locally with synthetic fixtures and existing locked dependencies. No commits, remote builds, updates, distribution or real attendance submissions.

## Checks and actual results

| Check | Baseline | Final |
| --- | --- | --- |
| `npm test -- --runInBand --watchman=false` | 154 suites passed; 3,203 passed, 13 TODO, 3,216 total; 53.943 s. Assertions passed, runner retained GC timers. | **160 suites passed; 3,254 passed, 13 TODO, 3,267 total; 41.585 s; exit 0**, no lingering-process warning. Timings are not a controlled application performance comparison. |
| `npm run lint` | 0 errors, 19 hook warnings | 0 errors, 19 existing hook warnings. No lint rule weakened or warning suppressed. |
| Localization validation | Existing 1,458 EN/AR keys | `npm run validate:localization`: 1,458 each; zero resource errors, conflicting translations, missing literals or unlocalized source sites. 57 dynamic translation call sites still require semantic/runtime review. |
| Dependency tree | Installed npm/package-lock | `npm ls --all --json`: no reported dependency-tree problems. Offline Expo dependency check exited 0; CLI warns that offline validation is limited. |
| Security advisories | Existing graph | `npm audit --json`: 74 affected entries (2 critical, 22 high, 43 moderate, 7 low); advisory exit 1. Unresolved; runtime exploitability separately assessed in [security report](security.md). |
| TypeScript | No project check configured | **Unavailable**, not passed. Installed TypeScript 6.0.3 does not define a project typecheck; JS/JSX changes do not justify inventing a broad tsconfig. |
| Android Hermes export | 7,591,035 B | 7,601,798 B; success. |
| iOS Hermes export | 7,572,952 B | 7,583,508 B; success. |
| Android debug native build | Local generated project/toolchain available | **Success**, final incremental build 17 s, 598 tasks; arm64-v8a, offline Gradle, no deployment. Existing Gradle deprecations remain. |
| iOS debug simulator build | Committed project/installed Pods available | **Success**, generic simulator destination, signing disabled. Built plist has Crashlytics debug collection false. No native attendance source changed. |
| Kotlin production-source journal harness | Installed Kotlin/Java + cached JSON-java jar | **28 cases passed**, real journal/store/access-policy/diagnostic sources with filesystem-backed adapters. Not Android OS delivery evidence. |
| Release archive/signing/store submission | Outside safe local audit | **Not performed**. Debug compilation does not establish signed release behavior, dSYM/source-map upload or store acceptance. |
| Final diff | Clean starting tree | Reviewed source/tests/docs; `git diff --check` passed. No schema reset/dependency upgrade/native attendance rewrite. |

Affected-suite passes overlap and must not be added together: auth/network 13 suites/267 tests, offline/consumers 32 suites/713 tests +13 TODO, native/geofence 12 suites/270 tests, privacy UI five suites/121 tests. Final incremental manual-attendance/feature-settings privacy checks passed two suites/106 tests. The full-suite result above is authoritative. New tests increased passing assertions by **51** across six additional suites and existing files.

## Reproductions and test quality

New regressions were exercised against the original affected implementations where practical: startup failed to reach the useful screen with an unresolved update request; banner overlapped checks/background work; six NetInfo tests failed; permission withdrawal caused four unwanted background prompts; three FCM delayed callbacks escaped teardown; Chat retained its old-language header. Tests then passed with remediation.

Real SQL-backed tests cover known-tenant filtering, NULL-provenance retention, derived counts and ownership changes. Real installed SDK/lookup fixtures remain in the full suite. Native-source string/config tests establish declarations and compatibility guards only; they do not establish OS behavior. No failing test was disabled and no force-exit flag was used to obtain the final clean result.

| Critical scenario requested | Executable evidence / remaining limit |
| --- | --- |
| Kill during upload / accepted write loses response | `attendanceDirectReceipt`, `attendanceSyncService`, `autoAttendanceAmbiguousDispatch`; simulated durable dispatch/review, no proof of actual OS-kill/server transaction boundary. |
| Simultaneous duplicate boundaries / manual-auto race | `autoAttendanceDurableEvents`, `autoAttendanceEventProcessor`, `attendanceSessionState`, `hybridAttendance.integration`; physical jitter/delivery timing remains a device gate. |
| Internet probe differs from tenant reachability | `networkListenerLifecycle`, `instanceAvailability`, `manualLocationTransport`, offline API tests; no real network/firewall changes. |
| Permission/eligibility/tenant switch during a flow | `autoAttendanceOnboarding`, employee/tenant policy suites and new queue UI scope races; existing OS dialog cannot be canceled. |
| Restart with pending records / two claim workers | Queue claims/repository/migration/native ingress/Android-worker suites and Kotlin harness; actual platform process/reboot tests still required. |
| Logout/auth expiry during synchronization | `attendanceAuthRecovery.integration`, `sessionResilience`, `attendanceExpiryRecovery`, FCM logout/callback regressions; live SDK refresh compatibility unverified. |
| Clock changes | `serverClock` and existing scheduling contracts; wall-clock-rewound live leases remain an identified unresolved risk. |
| Existing queue migrations | `attendanceQueueMigration`, legacy manual/photo fixtures; no real device DB reset/migration executed. |
| Callback after teardown / conflicting reconciliation | New network/FCM/UI guards plus existing verification/session authority suites; unknown conflicts retain evidence rather than imply exactly-once effects. |

## Simulator evidence and limits

A fresh disposable iPhone 17 Pro simulator on iOS 26.5 booted and launched the unsigned local debug application through localhost Metro with dotenv loading disabled, no stored account and no configured tenant. Visually inspected Welcome in [English/light](evidence/ios-welcome-en-light.png) and [Arabic/dark](evidence/ios-welcome-ar-dark.png): both auth entries visible, mirrored Arabic controls, readable labels and safe-area layout in this viewport.

The unsigned build emitted `ERR_NOTIFICATIONS_KEYCHAIN_ACCESS` for a required entitlement, shown in the screenshots' debug overlay. The app still reached Welcome. This is an explicit limitation of the unsigned simulator check, not a passed push/keychain test or evidence that release provisioning is correct. No login, OTP, camera/biometric, real GPS, background attendance, screen-reader or largest-text walkthrough was performed in this simulator session.

The [Android smoke report](android-smoke.md) records a fresh API 36 ARM64 Pixel 7a emulator reaching English/Arabic Welcome and empty mobile forms, with language switching/back navigation and no fatal process-scoped error observed. Four screenshots are retained. An initial IPv6/IPv4 Metro mismatch was resolved by temporary loopback-only developer forwarding, without changing firewall/host network settings. No company/credential input, submit or tracking activation occurred. The emulator, AVD, proxies and root Metro were cleaned up; the disposable iOS simulator was removed after screenshots.

Real signed Android/iOS devices remain mandatory for killed-process/reboot/locked-device, permission/precision, notification/account-switch, battery and attendance-delivery validation. No physical-device result is inferred from emulator results.

Temporary tool restrictions initially blocked Gradle caches, CoreSimulator and adb socket access; ordinary scoped local-build/simulator approvals allowed those checks to proceed. One later simulator action was not executed because automatic approval review hit a usage limit; after the user requested continuation, the normal approval path succeeded. No check bypassed that review.

## Phase 2 — 5 November 2026

Authoritative current results. They supersede the Phase 1 counts above. The tree is the recovered uncommitted Phase 1+2 work plus the continuation's OFF-STRAND fix and harness hardening. All runs are local, with synthetic fixtures and no tenant requests.

| Check | Result |
| --- | --- |
| Full Jest, first run of the continuation | **162/163 suites; 1 failed** (`androidAttendanceBackgroundWork`, OFF-STRAND), 3,314 passed, 13 todo. The previous session had not run the full suite after OFF-PAIR. |
| Full Jest, `npx jest --runInBand --watchman=false`, final | **163/163 suites, 3,319 passed, 13 todo, 3,332 total, exit 0**, 58.5 s, no lingering-process warning. |
| ESLint (`npm run lint`) | **0 errors, 19 existing warnings**, unchanged. `git diff --check` passes. |
| Localization (`npm run validate:localization`) | **1,460 EN / 1,460 AR keys**, zero resource errors, conflicts, missing literals or unlocalized sites. 57 dynamic calls remain for semantic review. |
| Real-disk WAL kill harness (`attendanceQueueProcessDurability`) | **6/6 scenarios**, Node 22.14 `node:sqlite` / SQLite 3.47.2, `SIGKILL`, WAL frames asserted before reopen. Two mutation checks fail as intended. Host SQLite only, not expo-sqlite or handset power loss. |
| Queue integrity focused (`attendanceQueueIntegrity`, `androidAttendanceBackgroundWork`, durability) | **45/45**. With the OFF-STRAND writers disabled, the 2 positive regressions fail. |
| Dependency graph | `npm ls --all`: no problems. `npm audit`: **32 entries (0 critical, 9 high, 14 moderate, 9 low)**, identical to the stored `currentAudit`. Remaining highs need major `expo`/`@react-native-firebase` changes ([security](security.md)). |
| Hermes export (`EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform all`) | **Success.** Android 7,905,744 B, iOS 7,887,480 B: **+303,946 B / +303,972 B (~4%)** vs the Phase 1 final export. Most likely from the Phase 2 dependency updates; not attributed or profiled. Hermes bytecode load cost is not measured. |
| Android debug build (`./gradlew assembleDebug --offline`, arm64-v8a) | **BUILD SUCCESSFUL in 33 s**, 834 tasks (240 executed). Debug APK 92,821,522 B. Not a signed release. |
| iOS debug simulator build (`xcodebuild … generic/platform=iOS Simulator CODE_SIGNING_ALLOWED=NO`) | **Success** (exit 0, 360 s, signing disabled). 15 `-quiet` "failed with exit code 0" lines are steps that emitted warnings, not failures. Built `Info.plist`: `FirebaseCrashlyticsCollectionEnabled = false`. Not a signed archive. |
| Swift Foundation journal harness (`swiftc` with the macOS 27 SDK, `arm64-apple-macosx15.0`) | **103 checks passed**. |
| Kotlin JVM journal harness (`run-journal-tests.sh`, kotlinc 2.4.20, OpenJDK 17.0.19) | **30/30 cases passed**, exit 0, no compiler warnings. Same count as the previous Phase 2 run ([geofencing](geofencing.md)); no regressions. JSON-java **20180813**, the version from the earlier runs, was downloaded from Maven Central (`repo1.maven.org`) into a temporary directory, outside the repository and app bundle. Its SHA-1 `8566b2b0391d9d4479ea225645c6ed47ef17fe41` and MD5 `0b1d8d278105d260dd8f5a97d80bfd5a` match Maven Central's published checksums. It is byte-identical to the copy in the local Gradle cache that the earlier runs used, which is still present. SHA-256 is `518080049ba83181914419d11a25d9bc9833a2d729b6a6e7469fa52851356da8`. The PGP signature (`.asc`) was **not verified** because `gpg` is not installed, so the checksums prove an intact download, not who signed it. This harness runs the production journal/store/access-policy/diagnostic sources on the JVM; it does not exercise Android SharedPreferences, receivers, WorkManager, process death or reboot. |
| TypeScript | **Unavailable**: no project typecheck is configured. |
| Simulator/emulator UI, physical devices, staging backend, signed release | **Not performed in Phase 2.** The Phase 1 smoke evidence above is unchanged. None of these gates is closed by the results in this table. |

# Application audit and production readiness — 4 November 2026

**Assessment: Not ready for production release.** Safe local remediations are implemented and validated, but essential live backend, dependency/security and physical-device background gates remain. This is not a claim that the app is unusable; it is a decision not to certify release from mocked tests/debug builds alone.

Source baseline: `fa3ed0352d13fe3c26a24978f30453a899d11c7d`; initial Git tree clean. Work remains uncommitted. Phase 1 (4 Nov) changed no dependencies. Phase 2 (5 Nov) applied compatible Axios/Zod/transitive patches only ([security](security.md)). No schema migration, queued-record change, attendance submission or build publication occurred in either phase.

**Phase 2 status (5 Nov):** OFF-PAIR, OFF-CLOCK, OFF-MANUAL (local copy) and NET-UPLOAD are fixed locally. The continuation found and fixed OFF-STRAND, a regression introduced by OFF-PAIR. It hardened the real-disk WAL kill harness and reran the full suite (**163/163 suites, 3,319 passed, 13 todo**), both Hermes exports, both debug builds and the Kotlin journal harness (30/30) ([validation](validation.md#phase-2--5-november-2026)). The assessment below is unchanged: the remaining gates are backend, device and approval gates, not local defects.

## Deliverables

| Deliverable | Evidence |
| --- | --- |
| A. Current architecture and ownership | [Architecture](architecture.md), [source/config inventory](source-inventory.json) |
| B. Prioritized confirmed findings and outstanding risks | [Issue register](issue-register.md) |
| C. Fixes, root causes, files, safety and regressions | [Implementation summary](implementation.md), [auth/network/push](auth-network-security.md), [geofence/UI](geofencing.md), [offline](offline.md) |
| D. Before/after performance evidence and unmeasured limits | [Performance report](performance.md) |
| E. Security findings, dependency exposure and remaining protection gaps | [Security report](security.md), [advisory inventory](dependency-advisories.json) |
| F. Checks, counts, native/simulator outcomes and unavailable validation | [Validation report](validation.md), [Android smoke](android-smoke.md) |
| G. Readiness classification | This assessment and release gates below |
| H. Remaining engineering action plan | Prioritized next steps below and unresolved issue register |
| Skill discovery/use | [Skills and adaptations](skills.md) |

## Demonstrated results

- Fixed tenant-crossing queue UI reads and old-owner publication, stale network observations, stale QR/FCM effects, failed-topic cache handling, private diagnostic logs and obsolete permission prompting.
- Removed update-server availability from startup and made foreground OTA work single-flight and bounded by lifecycle. No measured device startup/battery speedup is claimed.
- Disabled debug crash collection, fixed retained Chat localization and disposed test-owned query timers.
- Final full suite: **160 suites passed, 3,254 tests passed, 13 existing TODO; clean exit 0**. Lint: **zero errors, 19 existing warnings**. Both Hermes exports and both local native debug builds passed; Kotlin journal harness **28 cases passed**.
- Fresh unauthenticated iOS simulator reached EN/light and AR/dark Welcome; a disposable Android emulator reached EN/AR Welcome and mobile forms with working language/back navigation. The unsigned iOS keychain-entitlement warning limits push validation; screenshots and exact limits are retained in the reports. Temporary simulators/emulator/proxies/Metro were cleaned up.

## Release gates and remaining action plan

1. **Backend/staging ownership:** validate both login methods, OTP-only/recovery, explicit employee mapping, attendance policy and SDK refresh-token compatibility using disposable tenants. Verify accepted-but-response-lost direct/offline/manual writes, duplicate envelopes, exact timestamp/history reconciliation and conflicting server state. Establish idempotency/verification support; do not claim exactly-once effects.
2. **Attendance integrity:** atomic admission/rejection, bounded lease repair and the OFF-STRAND fix are implemented and covered locally (real WASM SQLite plus a host WAL `SIGKILL` harness). Still open: kill/reboot/clock-change on signed handsets with expo-sqlite, and review of retained historical incomplete pairs. A manual punch after a lost response still needs an authoritative backend idempotency/reconciliation contract. Existing queued evidence must remain intact.
3. **Dependency/security ownership:** triage all current advisory entries by actual runtime reachability and patch through compatible parent versions; prioritize Axios/SDK validation dependencies and build-tool trust boundaries. Plan secure credential/backup/data storage migration with old-binary and before-first-unlock recovery. Major framework/native migrations require separate approval and device validation.
4. **Platform QA:** run signed release builds on supported Android OEM devices and iPhones through OS kill/force-stop/force-quit, boot, first unlock, revoked foreground/background/precision permissions, airplane/network handover, tenant outage and quick account switching. Confirm warnings-only/disabled employees never auto-punch or receive unnecessary prompts.
5. **Release evidence:** profile cold/warm/resume first useful screen, frame/heap, queue/journal growth and shift-length energy with identical workloads before/after. Exercise all authenticated screen variants, EN/AR/RTL, small/large text, keyboard, VoiceOver/TalkBack and error/offline/recovery states. One unauthenticated simulator viewport is not the complete UI matrix.
6. **Release operations:** agree on CI lint/Jest/localization/bundle/native gates, review signing/environment/runtime versions and permission/store declarations, validate source-map/dSYM crash correlation and privacy policy, and rehearse rollback without reversing durable migrations. No deployment/submission is authorized by this audit.

Remaining app behavior, device and backend risks are explicitly classified in the register. No high-risk migration or contract change was applied simply to remove a release blocker from the report.

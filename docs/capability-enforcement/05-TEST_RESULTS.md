# Test results

This is the previous implementation's test record. The follow-up review's current counts, commands and remaining release gates are in [09-RELEASE_READINESS.md](09-RELEASE_READINESS.md).

Local JavaScript validation on 2026-10-16. No real authentication tokens or production credentials were used in new fixtures. Test transports/native modules are mocked; SQLite integration uses the existing sql.js adapter.

## Final checks

- `npm test -- --runInBand --watchman=false --forceExit`: **110 suites passed; 2,408 tests passed; 13 existing TODO tests**. The TODOs remain in earlier automatic-attendance characterization/provenance suites and are not counted as executed passes.
- Focused boundary/lifecycle/transport, feature settings, services, navigation, camera, automatic/offline recovery and location suites passed during implementation; the complete suite above includes them.
- `git diff --check`: passed.
- `npm run lint`: unavailable, exit 2. ESLint 8.57.1 reports it cannot find a configuration file. No lint configuration was invented for this task.
- TypeScript: no `tsconfig.json` or typecheck script is checked in. There is no project typecheck to run; installed TypeScript alone is not a check.
- No dependency changes; Metro dependency-transform verification was not required. No native source changes, builds, simulator/device runs, remote integration, EAS update/submit, commits or pushes were performed.

The ordinary serial command also reports all suites/assertions passing, but leaves asynchronous handles open. The final run adds `--forceExit` to obtain an explicit process exit after the same assertions; this does not establish handle cleanup. Existing React Native UI suites also emit `act`/renderer warnings. These harness limits are not native verification.

## Regression coverage

| Requirement | Executed evidence |
| --- | --- |
| Every Boolean enabled/disabled | `capabilityPolicy.test.js` parameterizes `BOOLEAN_PATHS`; `capabilityServices.test.js` exercises all 26 actual optional service entry points and attachments in both states. Location switch parsing/evaluation is tested without inventing unresolved precedence. |
| Geo enum 0/1/2 | `featureSettings.test.jsx` checks numeric/string/legacy labels and unknowns; `autoAttendanceSlice`, registration, bootstrap and event processor suites verify disabled, warning-only and action modes. |
| UI/routes/open screen changes | `capabilityNavigation.test.jsx` covers every mapped route in modern/legacy, live denial, legacy pins/picker; `hybridAttendance.integration.test.jsx` checks camera callbacks/capture after revoke/logout/re-auth. |
| Direct service and transport invocation | `capabilityServices`, `capabilityRequests`, `capabilityTransport`; disabled paths send no feature request, including login transport-header misuse. |
| Policy flip during request/refresh | `capabilityTransport` blocks 401 replay after denial, rejects delayed cross-tenant success/401 before follow-up work/refresh, and preserves an already dispatched same-owner success. |
| Offline disablement and accepted data | `attendanceQueueService`, `attendanceCapabilityRecovery`; queue admission rechecks while gate/timestamp work awaits, accepted rows still deliver after offline/automatic disablement. |
| Previous tenant and stale session | `autoAttendanceQueueProvenance`, `attendanceRecovery`, `attendanceCapabilityRecovery`, migration/sync/API suites; stale same-tenant generation refuses new row, accepted row survives, fresh same-tenant operation works; foreign/unattributed rows retained. |
| Native/background after revocation | `autoAttendanceBootstrap.durable`, `autoAttendanceEventProcessor`, `autoAttendanceBridgeCapability`, registration and legacy bootstrap suites. JS checks only; no device claim. |
| Cold restoration/settings failure/malformed response | `capabilitySettingsLifecycle`, `capabilityPolicy`, `featureSettings`; scope matching, identity restoration, late/superseded responses, malformed-success failure, partial merge, stale denials. |
| Logout suspension and microtask races | `capabilityPolicy`, `capabilitySettingsLifecycle`, hybrid camera suite; no work during cleanup, no identity resurrection, no stale allow across snapshot continuation. |
| Break callbacks/timers/checkout | `capabilityAttendanceHook` plus existing break-rules/totals suites; disabled reads/actions/timers are suppressed without dropping local break data or blocking checkout. |
| Restricted IN vs unrestricted OUT | `manualAttendanceScope.test.js` uses real service + Axios adapter for employee geo modes 0/1/2: outside-radius IN refused, OUT succeeds when employee policy explicitly grants the exception. `offlineGateGeofence` preserves automatic EXIT radius independence. |
| Shared essential history | `attendanceCapabilityRecovery` exercises actual interceptor + SQLite: history-disabled browsing fails, scoped existing-row verification and essential current-status read still work. |

## Failures investigated during implementation

The initial full run exposed two payload-only suites without policy setup and a stale-source test expecting creation of an unattributed row. Later auth-generation hardening exposed another historical test with that same expectation. Payload-only fixtures now isolate policy deliberately; dedicated real-policy suites verify enforcement. Stale-scope tests now assert refusal, accepted-record preservation and fresh-owner success. All are included in the passing final suite.

## Unverified checks

No actual Rowad/TDI settings or disposable staging access were supplied. Synthetic representative configurations are used. Backend authorization, SDK token/backend compatibility, live attendance acceptance, actual route/native rendering across device themes, Android reboot/OEM delivery and iOS suspended/terminated wake behavior remain unverified. See `06-REMAINING_RISKS.md`.

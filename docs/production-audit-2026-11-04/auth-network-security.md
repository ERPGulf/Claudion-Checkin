# Authentication, networking, security and push audit

Date: 2026-11-04. Baseline: `fa3ed0352d13fe3c26a24978f30453a899d11c7d`, initially clean working tree.

## Scope and evidence

Reviewed `services/api/` endpoint contracts, request interceptors, refresh and credential persistence; `services/queryClient.js`; `services/notifications/`; `services/crashlytics.service.js`; QR and mobile login orchestration; provisioning, authentication-generation and diagnostic helpers; and their contract/lifecycle tests. Read `AGENTS.md`, `CLAUDE.md`, authentication/app-infrastructure architecture references and the installed ERPGulf SDK/lookup READMEs. The available skills contain no specialist authentication/networking audit workflow; used repository contracts, call-site tracing, synthetic failure injection and regression tests. Final cross-subsystem review is coordinated by the primary audit.

No production endpoint, credential, attendance submission, external upload, dependency change or native change was used. The following is source/test evidence, not a penetration test or physical-device push validation.

## Architecture and invariants

| Boundary | Current ownership and behavior |
| --- | --- |
| QR credentials | `auth.service.generateToken` invalidates the authentication generation, uses `x-skip-auth`, requires access and refresh tokens, and delegates durable writes to `saveTokens`. Both presentation variants publish Redux sign-in afterward. |
| Mobile discovery | `useMobileLogin` keeps company code/transient credentials in memory. Existing `backendUrl` bypasses lookup configuration. Typed HTTPS addresses use package normalization; lookup is single-attempt and lazy. |
| Mobile authentication | One SDK client per supplied backend URL; guarded lazy `expo/fetch` transport refuses redirects and omits cookies. Flow requirements drive fields and password recovery; OTP retries are explicit. |
| Mobile hand-off | Verifies canonical employee identity and complete policy before provisioning/token/sign-in writes; generation guards, scoped policy persistence and rollback protect newer sessions. Live compatibility remains a separate gate. |
| Axios | Request-time context, destination tenant check, capability/scope guards, ordinary 401 refresh, ordinary 403 passthrough. Refresh is shared across concurrent interceptor requests. Rotated tokens persist before memory. Transient refresh failures retain the session. |
| Attachments | Four global `fetch` multipart paths bypass Axios refresh and timeout behavior; capability checked immediately before submission. No automatic upload retry was added. |
| Query cache | Authentication invalidation synchronously clears queries and mutations, preventing same-code tenant collisions and detached old-query completion from restoring old cache entries. Domain hooks own refetch/retry policy. |
| Push | Firebase registration, token storage, topic diff, unread count and safe navigation. Logout awaits local cleanup while Firebase deregistration is asynchronous and epoch guarded. This audit extends guards to delayed setup/callback work. |
| Diagnostics | Mobile SDK diagnostic serializer masks credential fields; Crashlytics lazily tolerates older binaries, hashes employee identity and bounds nonfatal deduplication. This does not prove all possible thrown messages are free of personal data. |

## Confirmed defects fixed

### AUTH-01 — P1: QR failure diagnostics emitted arbitrary server payloads

- Locations: `hooks/useLogin.js:143`, `screens/LoginLegacy.jsx:127` (original catches logged `error.message` and `error.response.data`).
- Evidence: inject a 500 error whose message and response contain a synthetic password/token echo. Both variants previously serialized the echo to console. These diagnostics were not development gated.
- Impact: server-echoed credentials or employee details could reach device logs.
- Fix: use existing `describeHttpFailure`, which emits only a bounded code and numeric HTTP status. Error UI and endpoint contracts remain unchanged.
- Regression risk: low; removes diagnostic text, retaining the existing error mapper and toast behavior.
- Verification: parameterized modern/legacy login tests assert metadata remains available, synthetic secrets are absent, and error feedback still occurs.

### AUTH-02 — P1: QR hand-off could republish sign-in after invalidation

- Locations: `hooks/useLogin.js:100`, `screens/LoginLegacy.jsx:84`.
- Evidence: invalidate authentication during the awaited `employee_id` write after token acquisition. The previous continuation unconditionally dispatched `setSignIn` with the old token. Both variants also published post-login unread counts/success feedback after delayed notification work.
- Impact: logout/account replacement could be followed by an obsolete login result restoring authenticated navigation.
- Fix: capture the generation immediately after invoking `generateToken` (which invalidates synchronously before its first await); verify it after token acquisition, employee persistence and notification work, before publishing effects.
- Safety: leaves `generateToken` return shape, sole token writer, successful-login navigator ownership and employee persistence unchanged. It suppresses only work whose generation has been superseded.
- Regression risk: low to medium; relies on `generateToken`'s existing synchronous invalidation contract, documented at the call site. Both presentation variants receive the same checks.
- Verification: parameterized modern/legacy UI tests invalidate during employee persistence and assert no authenticated state, notification request or success toast is published.

### PUSH-01 — P1: delayed FCM work survived teardown/account changes

- Locations: `services/notifications/fcm.service.js:675` (unread count), `:699` (open), `:739` (initialization), `:930` (topic fetch), `:1163` (cleanup).
- Evidence: three newly added tests were run against the original implementation and failed: a foreground callback completed after teardown and dispatched unread state; a token fetch completed after logout, persisted the stale token and installed listeners; an opened notification completed after authentication invalidation and navigated/dispatched. A further regression exercises a late old-account topic response.
- Impact: previous employee notification content/navigation/badges and topic work could affect the next session; obsolete initialization could restore push state after cleanup.
- Fix: capture authentication generation and FCM epoch at operation start; carry that guard through token/topic/unread/open work, check after asynchronous boundaries, and use a local active flag set before listener teardown. Cleanup now invalidates pending FCM work immediately and stops if a newer setup starts during its initial storage read.
- Safety: preserves notification payloads, route aliases, registration payload, refresh-token topic-baseline reset, asynchronous Firebase logout and successful foreground delivery. No retry timers or additional network calls.
- Regression risk: medium; crosses asynchronous notification paths. Existing payload, logout, token-rotation and topic tests remain green. Already dispatched native/network operations cannot be undone by a JavaScript generation check.
- Verification: four synthetic delayed-completion regressions plus existing successful delivery/logout tests. Does not establish actual APNS/FCM/device behavior.

### PUSH-02 — P2: failed native topic changes were cached as completed

- Location: `services/notifications/fcm.service.js:410`.
- Evidence: per-topic Firebase errors were caught, then the full requested `syncedTopics` list was saved anyway. A failed subscribe appeared subscribed forever; a failed unsubscribe disappeared from the cache. The next ordinary diff therefore omitted the failed operation.
- Impact: missed employee notifications or retained obsolete topic subscription until token reset/storage reset.
- Fix: initialize the cache from current topics and update it only for successfully resolved native subscribe/unsubscribe operations. Failed changes remain differences on the next existing sync.
- Safety: no immediate retry, background polling or new request schedule; unchanged-topic diffs remain empty. Cache reflects successful local operations rather than claiming remote certainty.
- Regression risk: low to medium; native failure can be ambiguous, but repeating Firebase topic subscription operations is the same supported operation the app already performs after token rotation. Physical-device behavior remains unverified.
- Verification: one regression fails both native operations once, confirms the old cache is retained, then confirms the next normal sync attempts both again and records the successful final state.

### TEST-01 — P2: a detached test query kept Jest alive for five minutes

- Location: `__tests__/queryClientSession.test.js:59`, the delayed old-tenant response test.
- Evidence: each of the nine additional auth suites was run in a bounded standalone subprocess; only `queryClientSession` stayed alive after its passing summary. Running each of its six tests separately isolated the delayed-response test. Temporary timer instrumentation captured one pending 300000 ms timer with stack `Query.fetch` (`@tanstack/query-core/src/query.ts:603`) → `Removable.scheduleGc` → `timeoutManager.setTimeout`.
- Root cause: `queryClient.clear()` destroys/cancels and detaches the old query; its later fetch `finally` schedules garbage collection again. The test's `afterEach` can clear only cached queries and cannot reach the detached object.
- Impact: an otherwise passing full test run remained alive, obscuring a usable local/CI completion result.
- Fix: retain the test-owned old Query and destroy it in `finally` after cancellation settles. No production query defaults, test assertions, shared setup, dependencies or Jest exit settings changed.
- Regression risk: low; cleanup occurs after the cancellation/cache-isolation assertions and touches only the synthetic detached query.
- Verification: the uninstrumented six-test suite now exits 0 (0.46 seconds of test execution); the instrumented isolated test reports `[]` pending timers and exits 0; the full thirteen-suite auth selection now also exits 0 with 267 passing tests (5.09 seconds).

### TEST-02 — P2: UI tests retained their QueryClients after unmount

- Locations: `__tests__/loanApplicationUi.test.jsx` client factories and `afterEach`; `__tests__/requestHistory.test.jsx` client factories and `afterEach`.
- Evidence: a complete diagnostic run passed all 160 suites/3251 tests (13 TODO) but remained alive. Per-suite timer allocation tracing found 36 referenced five-minute GC timers in the loan suite (32 query, four mutation) and six in request history. Their stacks identify Query/Mutation observer removal and garbage-collection scheduling. These are distinct from TEST-01's detached-query timer.
- Root cause: the suites created real, independent QueryClients for rendered hooks/screens but never disposed their caches after React Native Testing Library unmounted the observers.
- Fix: track each test-owned client; explicitly unmount observers, await query cancellation, destroy mutation GC timers and clear caches in `afterEach`. The assertions, application hooks, production query configuration and shared Jest setup remain unchanged.
- Regression risk: low; resource disposal runs after each test, and cancellation settles before cache clearing to avoid rearming detached-query timers.
- Verification: both suites pass all 61 tests and exit 0; the same instrumentation now reports no pending timers for either suite. Targeted ESLint and `git diff --check` pass. The final ordinary full run also exits 0: 160 suites passed, 3251 tests passed, 13 TODO, 46.057 seconds, with no lingering-process warning.

## Outstanding risks and release gates

| ID / priority / status | Location and evidence | Impact, remediation, risk and verification |
| --- | --- | --- |
| AUTH-R1 / P1 / essential live verification missing | `services/api/mobileAuth.service.js:183`, `:213`; `docs/mobile-sign-in.md` and installed SDK contract notes | Local fixtures do not prove tenant employee mapping, OTP/password-recovery envelopes, attendance policy fields or SDK-issued refresh-token compatibility with the existing refresh endpoint. Validate disposable staging accounts through QR, mobile/password, OTP-only, recovery, policy and access-token expiry. Do not add a second refresh mechanism. Backend-contract changes need coordinated approval; rollout remains blocked until verified. |
| SEC-R1 / P1 / confirmed storage limitation, exploit not demonstrated | `services/api/apiClient.js:168`, `redux/Slices/AuthSlice.js:4`, `redux/Store.js` | Access/refresh tokens are in AsyncStorage and access token also lives in persisted Redux; no application-level secure credential storage is implemented. Plan a native secure-storage migration with locked-device/background-first-unlock behavior, rollback, token rotation and old-binary compatibility. Introducing that migration automatically would exceed a safe local fix. Verify encrypted backup/device-extraction policy and background recovery on real devices before approving storage design. |
| NET-R1 / P2 / confirmed implementation gap | `services/api/leave.service.js:129`, `expense.service.js:154`, `complaint.service.js:98`, `attendance.service.js:978` | Multipart global-fetch uploads lack explicit timeouts and Axios token refresh. A stalled upload can retain pending UI; an expired bearer fails until the caller retries. A shared bounded upload transport needs preserved per-service result shapes and no automatic non-idempotent retry; validate timeout/401/accepted-but-response-lost cases before adoption. No endpoint or upload contract changed in this audit. |
| SEC-R2 / P2 / confirmed disclosure surface | `services/api/errorHelper.js:6`, `:21`; direct leave/complaint error return paths | Several HR services pass raw backend error text into existing error contracts/UI. This can disclose exception/private details if a tenant emits them. Design app-owned localized error classification using representative sanitized backend examples; keep known validation feedback and contract shapes. Scope is broader than auth logging, so no blanket replacement was made. Verify modern and legacy HR flows before rollout. |
| PUSH-R1 / P2 / platform race requiring device validation | `services/notifications/fcm.service.js:1116`, `:432` | A native Firebase operation already in flight cannot be canceled merely by incrementing JavaScript epochs. Existing asynchronous token deletion/topic changes can still complete near an immediate relogin; this audit suppresses later JavaScript follow-up, not native completion. Exercise delayed deleteToken/subscription on device, quick account switching and offline relogin; consider explicit native operation serialization if reproduced. |
| OBS-R1 / P2 / confirmed diagnostic boundary limitation | `services/crashlytics.service.js:208`, `:257` | Nonfatal reporting forwards an Error's message/stack. Callers generally restrict reporting to programming errors, but reporting arbitrary future server-bearing errors would leak their contents. Keep the unexpected-error-only rule, review new call sites and establish a safe message policy before expanding collection. No external telemetry was sent by this audit. |

## Validation

| Check | Result |
| --- | --- |
| Original FCM implementation plus first three new lifecycle tests | 3 failures, 9 passes in one suite: intentional reproduction before remediation. |
| Four directly affected suites after all changes | 4 passed; 69 tests passed, 0 failed; about 1.4 seconds of Jest execution. |
| Initial broader auth/network/SDK regression selection with `--detectOpenHandles` | 13 suites passed; 267 tests passed, 0 failed; about 6.8 seconds of test execution, but runner remained alive. TEST-01 identified and fixed the exact timer. |
| Final broader auth/network/SDK regression selection, ordinary Jest invocation | 13 suites passed; 267 tests passed, 0 failed; 5.09 seconds; clean exit code 0 without `forceExit`. |
| Final full application suite after test-owned client disposal | 160 suites passed; 3251 tests passed, 13 TODO, 0 failed; 46.057 seconds; clean exit code 0 and no lingering-process warning. Command: `npm test -- --runInBand --watchman=false`. |
| ESLint: modified login hook, legacy screen, FCM service and three test files | Passed, no warnings/errors. |
| `git diff --check` | Passed. |
| TypeScript | No project typecheck script/tsconfig; changes are JS/JSX, so no artificial `tsc` result claimed. |
| Native build / physical push / live staging | Not performed by this sub-audit. Primary audit reports overall native availability. |

Affected suites: `loginUi`, `fcm.service.notifications`, `fcm.service.logout`, `fcm.service`. Broader selection also included `apiClient`, `sessionResilience`, `authProvisioning`, `authFlowMatrix`, `mobileAuthSession`, `mobileLoginHook`, `serverLookup`, `mobileAuthCrypto`, `queryClientSession`.

No startup, rendering, memory, battery or networking speedup is claimed from these changes. The measured evidence is behavioral: obsolete effects are suppressed and failed topic operations remain recoverable without extra scheduled work. Full application suite and final diff review are recorded by the primary audit.

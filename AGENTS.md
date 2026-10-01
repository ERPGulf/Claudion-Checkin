# Repository Guidelines

## Purpose & Architecture

Claudion Checkin is an Expo/React Native employee attendance and HR app for multiple Frappe/ERPNext tenants. Employees choose QR provisioning plus password login, or company-code lookup plus mobile/OTP/password login. Both methods supply the same persisted tenant, employee, token, and attendance-policy context.

- `App.js`: Expo entry, persisted Redux and React Query providers, guarded native crypto installation, startup hydration, FCM/attendance/feature bootstraps, OTA checks.
- `navigation/`, `screens/`, `components/`, `hooks/`: auth routing, modern/legacy presentation, shared UI, and screen orchestration.
- `services/api/`: authenticated requests and domain contracts. `services/notifications/`: Firebase messaging and local notifications.
- `services/offline/`: SQLite attendance queue, cached policy, error classification, and synchronization. `utils/attendanceSessionState.js`: durable session authority shared by manual and geofence actions.
- `redux/Slices/`: persisted application state. React Query handles server queries; `settings/` holds preferences. `utils/` holds domain helpers; `constants/theme.js` and `assets/` supply styling and images.
- `modules/expo-auto-attendance/`: JavaScript bridge plus Kotlin/Swift geofencing. Native code stores/emits transitions; JavaScript submits attendance and replays eligible events after relaunch.
- `ios/` is committed; root `android/` is generated and ignored. Preserve module-native sources. Exclude the stale `.git-rewrite/` snapshot from searches and edits.

## Commands

Run from the repository root; use npm and `package-lock.json`.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies. |
| `npm start` | Start Expo's Metro development server. |
| `npm run android` / `npm run ios` | Build and run locally with platform tooling. |
| `npm test -- --runInBand` | Run the Jest suite serially. |
| `npm test -- __tests__/apiClient.test.js --runInBand` | Run one suite. |
| `npm run lint` / `npm run lint:fix` | Invoke ESLint or automatic fixes. |
| `npm run eas:build:preview` | EAS preview builds for both platforms; requires EAS CLI/account and committed changes. |

No ESLint/Prettier configuration, typecheck script, `tsconfig.json`, or CI workflow is checked in. TypeScript's installed dependency does not establish a typecheck. Lint scripts currently lack configuration. Use `--watchman=false` when Jest cannot use Watchman. EAS update/submit scripts publish remotely; see [README.md](README.md) for release commands.

## Coding & API Contracts

Use two-space indentation, semicolons, and surrounding quote style. Prefer functional components, PascalCase component filenames, `useCamelCase` hooks, and `*.service.js` API modules. Keep business logic in hooks/services/utils; reuse `components/common/`, theme tokens, and `useAppTheme()`.

- Read tenant/token/employee context at request time through existing helpers; do not memoize auth context across requests or hardcode a backend. Keep secrets out of logs; use synthetic credentials in fixtures.
- Preserve each endpoint's payload, content type, response unwrapping, and error contract: services variously throw, return `{ message }`/`{ error }`, or attendance `{ allowed }`. Check callers and contract tests before changing these shapes.
- `apiClient` refreshes ordinary 401s; ordinary 403s pass through. Transient refresh failures retain the session. Persist rotated tokens before advancing memory; preserve login's `x-skip-auth` path and provisioning on expiry.

## Authentication & Company Lookup

- Preserve the QR/password implementation and both presentation variants. Mobile sign-in uses one themed `screens/MobileLogin.jsx`, `hooks/useMobileLogin.js`, and `services/api/mobileAuth.service.js`; the exact route is `"mobile login"`. `readInitialAuthRoute` gives complete QR provisioning priority, then the last mobile method with a remembered URL when crypto is available, otherwise Welcome.
- Read the installed READMEs for `@erpgulf/auth-sdk` and `@erpgulf/server-lookup` before changing their integration. SDK calls use its own fetch and a reused client per HTTPS origin. Render credentials and password-recovery actions from the returned flow; omit blank credentials. No cold-boot/session-active authentication on launch or background relaunch. OTP sends have no automatic retry; subsequent sends within a flow require manual Resend, with cooldown from `expiresIn`.
- `backendUrl` is the mobile company preference; `baseUrl` is the canonical provisioned/session tenant. A stored `backendUrl` skips lookup. Otherwise normalize and validate the company code with the lookup package; invalid fields make no request. Save `backendUrl` only after successful SDK `begin()`. Never persist the company code. “Change company” clears the mobile preference and form; QR provisioning changes only after successful mobile hand-off. No manual server-address fallback.
- Keep `process.env.EXPO_PUBLIC_SERVER_LOOKUP_URL`, `process.env.EXPO_PUBLIC_SERVER_LOOKUP_SECRET`, and `process.env.EXPO_PUBLIC_SERVER_LOOKUP_ALPHABET` as literal property accesses inside the actual lookup call, with no other reads. Configuration validation stays lazy so established selections work without lookup configuration/service availability. Use the package's single attempt and 15-second timeout; no wrappers, retries, or cache. Map typed lookup configuration/kind errors to app-owned EN/AR copy; rethrow unknown lookup errors. An HTTP URL rejected by the auth SDK uses the invalid-response/support message.
- Never show, parse, or log SDK error messages, and never log SDK results/tokens. SDK error diagnostics contain only `code`, `httpStatus`, and `retryable`; honor `retryable`. Never log or commit lookup secrets/alphabets; fixtures use synthetic values. Escape literal `$` as `\$` in local `.env` values, use plain `$` in EAS values, and restart with `npx expo start -c` after changing public environment variables.
- Mobile hand-off invalidates the auth generation first and rejects stale operations or missing refresh tokens before writes. Verify explicit backend employee identifiers and complete attendance flags/locations before changing provisioning. Persist identity, use `saveTokens` as the sole token writer, and await scoped policy caching/mirroring before `setSignIn`. Successful hand-off clears QR keys, stale company/username state, and records `auth_method: "mobile"`; QR scans record `"qr"`. Failed persistence restores prior provisioning only while the cleanup generation is current. Tenant changes clear the previous attendance session while retaining queued punches.
- Mobile policy refreshes require explicit `restrict_location`, `unrestricted_checkout_location`, and `photo`; restricted employees need usable locations/radii. Missing mobile restriction data must refuse attendance. Preserve QR policy normalization/defaults. Token refresh remains solely in `apiClient`; live SDK employee mapping and refresh compatibility are still rollout blockers until staging verifies them. See [docs/mobile-sign-in.md](docs/mobile-sign-in.md) for configuration, response contracts, and outstanding live checks.

## High-Risk Constraints & Compatibility

- Route attendance through `performSessionTransition({ execute })`; its lock spans submission. Calling `readSession()` inside `execute` deadlocks. Queued acceptance is distinct from server confirmation.
- Manual punches are online-only. Automatic punches may queue under cached policy/capability rules. Transport availability, not NetInfo's internet probe, governs request attempts.
- Logout/expiry retain queued punches; cleanup clears policy/capability caches. Production drains require employee scope, which does not establish tenant isolation. Preserve atomic claims, deduplication, ordering, and check-in/check-out pairing. Unknown server failures remain recoverable; duplicates count as success. Offline uploads send one record per request.
- Retain SQLite migrations, legacy session keys, and older queued manual/photo records. Preserve backend normalization and unknown feature defaults; failed feature refreshes keep cached settings. Feature gates control UI, while servers authorize requests.
- Preserve route names and gated route registration; background navigation uses `navigateSafely`. Maintain modern/legacy consumers of shared hooks and FCM cleanup's session guard.
- Native bridge additions must tolerate older binaries. Native changes require builds; OTA needs matching channel/runtime. Keep `app.json` and iOS `Info.plist`/`Supporting/Expo.plist` aligned; app config alone does not update committed iOS settings.
- Mobile auth needs native `expo-crypto`. Keep its startup `require` and native probe inside `try/catch`; hide mobile entry points when `crypto.getRandomValues` is unavailable. An OTA alone cannot add the module. Preserve ERPGulf ESM transforms/entry mapping in Jest and verify Metro bundling when dependencies change.

## Testing & Definition of Done

Use Jest/`jest-expo` and React Native Testing Library in `__tests__/<feature>.test.js` or `.test.jsx`. Shared mocks live in `jest.setup.js`; queue suites override SQLite with `test-utils/expoSqliteMock.js` and declare `@jest-environment jsdom`. No coverage threshold is configured.

Add behavioral regression tests for changed contracts, authentication, attendance, migrations, or background lifecycles. Run focused suites; run the full suite for shared service/state changes. Verify affected screen variants/themes and test native behavior on appropriate builds/devices. Report checks, failures, and untested platform behavior; update relevant docs. Review the diff for unrelated changes. Commit history favors `feat:`, `fix:`, and `chore:`; PRs explain behavior and validation, link applicable issues, and show UI changes.

Mobile auth contracts are covered by `mobileAuthSession`, `mobileLoginHook`, `mobileLoginUi`, `mobileAuthCrypto`, `serverLookup`, and `authProvisioning`. Keep the lookup fixture encoder synthetic and decode through the real package with Expo's `expo/src/winter/TextDecoder`. Mocked tests/native builds do not establish live backend compatibility: verify both sign-in methods, OTP-only sign-in, password recovery, employee mapping, attendance policy, and SDK refresh tokens on a disposable staging setup before rollout.

## Deeper References

Before building or restyling any screen, read [DESIGN.md](DESIGN.md) for tokens, shared components, screen templates, and known platform UI pitfalls. Read the relevant [CLAUDE.md architecture sections](CLAUDE.md#architecture) for domain rationale and its [versioning guide](CLAUDE.md#versioning-gotcha) for release fields. [README.md](README.md) covers FCM and OTA procedures. Consult `sessionResilience`, `attendanceAuthRecovery.integration`, `attendanceQueueMigration`, and `attendanceOfflineApi` suites for executable contracts. Verify prose against current code when they disagree.

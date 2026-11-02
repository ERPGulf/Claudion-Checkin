# CLAUDE.md

Guidance for Claude Code in this repository. [AGENTS.md](AGENTS.md) holds the shared conventions, high-risk constraints and definition of done; read it before changing authentication, attendance or native code. Domain detail lives in [docs/architecture/](docs/architecture/): read the file for the area you touch (table below). Check code and regression tests before trusting prose.

## What this is

`claudion-checkin` is an Expo React Native employee attendance app for ERPGulf, multi-tenant on a **Frappe/ERPNext** backend: services call method endpoints, primarily `employee_app.*`, and unwrap endpoint-specific response envelopes. Employees sign in with QR + password, or by mobile (company-code lookup or a typed server address). `ios/` is committed; root `android/` is generated and gitignored; native module sources are committed under `modules/`. See `package.json` for framework versions.

## Commands

```bash
npm start                    # expo start (Metro)
npm run android              # expo run:android (native build)
npm run ios                  # expo run:ios (native build)
npm run lint                 # eslint . --ext .js,.jsx
npm run lint:fix
npm test                     # jest (all tests)
npx jest __tests__/apiClient.test.js          # single test file
npx jest -t "session timer"                    # single test by name
```

EAS / OTA (see README.md for the full OTA testing workflow):

```bash
npm run eas:build:preview              # build both platforms, preview channel
npm run eas:update:preview -- --message "..."   # publish OTA to preview channel
npm run eas:update:production -- --message "..."
```

`eas.json` sets `requireCommit: true` (EAS builds need a clean working tree) and `appVersionSource: "local"`. Channels: `development` / `preview` / `production`. ESLint uses the checked-in `.eslintrc.cjs`; there is no typecheck. Use `--watchman=false` when Jest cannot use Watchman. See [AGENTS.md](AGENTS.md#commands) for tooling limitations.

## Rules most tasks need

**Requests and authentication**
- Read tenant, token and employee at request time (`services/api/authHelper.js` or AsyncStorage). Never memoize them across requests or change the provisioned URL's scheme, and send session credentials only to the active tenant.
- `apiClient` refreshes ordinary 401s (one shared refresh) and passes ordinary 403s through; only a terminal credential rejection ends the session. Header `x-skip-auth: "true"` skips both the auth header and refresh (used by `generateToken`); `plainAxios` has no interceptors. Token refresh lives only in `apiClient`.
- Keep each service's payload, response and error contract (services variously throw, return `{ message }` / `{ error }`, or attendance `{ allowed }`); check callers and contract tests first. Preserve the import shapes of `services/api/index.js`.
- Never log tokens, passwords, OTPs, raw payloads or private employee data, and never persist raw OTPs or passwords. Never show raw SDK or server error messages to employees.
- Mobile sign-in validates employee identity and attendance policy before `setSignIn`. SDK refresh-token compatibility is unverified on staging: never add a second refresh path.

**Attendance**
- Every check-in/out goes through `performSessionTransition({ execute })` in `utils/attendanceSessionState.js`. Its lock spans `execute`: calling `readSession()` inside it deadlocks. `queued` is not `serverConfirmed`.
- Manual punches are online-only and never queued; only automatic punches queue. Whether to attempt a request depends on transport (`shouldAttemptRequest`), never NetInfo's `isInternetReachable`, and a reachability probe alone never queues a punch.
- Logout keeps queued punches. Preserve atomic claims, FIFO order, check-in/check-out pairing, one record per offline request, and "duplicate = success". An unknown failure stays `blocked`, never `rejected`. The `offline_attendance` admin switch gates new queueing, never delivery of rows already queued. Never assign a tenant to NULL-provenance rows or infer from paginated history that the server lacks a punch.
- Automatic attendance runs only when tenant `attendance_action.geo_tagging` is the boolean `true` AND the scoped employee `geotagging` is 2. A failed refresh keeps the last answer; an answer that omits the field is off.
- A new feature path needs a capability boundary guard and request mapping (`services/capabilityPolicy.js`); hiding a tile is not enforcement.

**App structure**
- Redux persists the entire root reducer. `selectIsLoggedIn` swaps `AuthNavigator` ↔ `AppNavigator`; sign-in never navigates into the app itself.
- Navigation from outside React (FCM handlers, interceptors) goes through `navigateSafely` in `navigation/rootNavigation.js`. Route names contain spaces (`"Attendance action"`, `"mobile login"`); match them exactly.
- Styling: NativeWind `className`, tokens from `constants/theme.js`, palette from `useAppTheme()`. Read [DESIGN.md](DESIGN.md) before building or restyling a screen.

**Native code and releases**
- Native changes need a new build; an OTA ships JS only. JS that calls a new native API must tolerate older binaries: make bridge calls optional, and `require` new native packages lazily inside `try/catch`, as `services/crashlytics.service.js` and `utils/mobileAuthCrypto.js` do.
- Android background sync: an `AttendanceSyncWorker` pass never returns `Result.retry()`, because WorkManager holds appended passes until it succeeds; leftover work arms the separate retry timer. See [attendance](docs/architecture/attendance.md).
- `app.json` does not set iOS versions. A version bump also edits `ios/ClaudionCheckin/Info.plist` and `ios/ClaudionCheckin/Supporting/Expo.plist` (`EXUpdatesRuntimeVersion`); see [releases and versioning](docs/architecture/releases-and-versioning.md).

**Tests**
- Jest (`jest-expo`) with React Native Testing Library; shared mocks are in `jest.setup.js`. Suites using the real queue mock `expo-sqlite` with `test-utils/expoSqliteMock.js` and **must declare `@jest-environment jsdom`**: under `node` the WASM SQLite fails with an empty error.
- Add regression tests when changing contracts, authentication, attendance, migrations or background lifecycles. Keep fixtures obviously fake; mocked tests do not prove live backend behaviour.

## Where the detail lives

| Read before touching | File |
| --- | --- |
| QR and mobile sign-in, Auth SDK, mobile hand-off, crypto gate, auth test suites | [docs/architecture/authentication.md](docs/architecture/authentication.md), then [docs/mobile-sign-in.md](docs/mobile-sign-in.md) |
| Networking, Redux and feature settings, navigation, push notifications, Crashlytics, styling | [docs/architecture/app-infrastructure.md](docs/architecture/app-infrastructure.md) |
| Session state machine, geofence capture, automatic attendance, background delivery | [docs/architecture/attendance.md](docs/architecture/attendance.md) |
| Offline queue, sync, retry ladders, failure states, history, queue tests | [docs/architecture/offline-attendance.md](docs/architecture/offline-attendance.md) |
| Version fields, runtime versions, EAS | [docs/architecture/releases-and-versioning.md](docs/architecture/releases-and-versioning.md) |

## Implementation Workflow

When implementing a feature:

1. Understand existing screen patterns.
2. Search for similar functionality.
3. Reuse existing services when possible.
4. Reuse existing components before creating new ones.
5. Keep business logic in utils/services.
6. Keep screens focused on presentation.
7. Update tests when modifying critical logic.

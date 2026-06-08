# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`claudion-checkin` is an Expo (SDK 54, bare workflow — has committed `android/` and `ios/` native projects) React Native employee attendance app for ERPGulf. The backend is a **Frappe/ERPNext** server: every API call hits `employee_app.*` (and a few other app) method endpoints, and responses are nested under `data.message` or `data.data`. The app is **multi-tenant** — there is no hardcoded backend; the server URL is provisioned per-device via QR scan.

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

`eas.json` sets `requireCommit: true`, so EAS builds need a clean git working tree. Channels: `development` / `preview` / `production`.

## Architecture

### Authentication & onboarding (QR → token)
1. A QR scan (`QrScan` screen) stores `baseUrl`, `api_key`, `app_key` in AsyncStorage. There is no server URL in code.
2. `Login` takes the user's password and calls `generateToken({ api_key, app_key, api_secret: password })` ([services/api/auth.service.js](services/api/auth.service.js)) → `employee_app.gauth.generate_token_secure`, which returns `access_token` / `refresh_token`. These are saved via `saveTokens()` and dispatched into Redux (`setSignIn`).
3. `selectIsLoggedIn` in [redux/Slices/AuthSlice.js](redux/Slices/AuthSlice.js) is the single source of truth for which navigator renders.

### Networking layer ([services/api/](services/api/))
- [apiClient.js](services/api/apiClient.js) is the axios instance with all auth wiring. The **request interceptor** reads `baseUrl` from AsyncStorage at call time and sets `config.baseURL`; the **response interceptor** handles 401/403 by refreshing the token (`employee_app.gauth.create_refresh_token`), with a `failedQueue` so concurrent requests share one refresh, plus terminal-failure handling (`hasTerminalSessionFailure`, `MAX_REFRESH_RETRIES`) that calls `expireSession()` → `clearStore()` (dispatches `setSignOut` + `revertAll`).
- Set header **`x-skip-auth: "true"`** to bypass the auth header AND the refresh logic — used for `generateToken`. `plainAxios` is a separate bare instance used by token refresh and FCM (no interceptors).
- **Convention:** most service functions also manually read `baseUrl`/`access_token` from AsyncStorage and build a full `http://...` URL and set the `Authorization` header themselves, even though the interceptor would do it. Follow the existing pattern in the relevant `*.service.js` when adding endpoints.
- [index.js](services/api/index.js) re-exports every service both as named exports and as a default namespaced object (`api.attendance.userCheckIn`, etc.). Each domain has its own file: `attendance`, `auth`, `employee`, `expense`, `leave`, `trip`, `complaint`, `qr`, `records`, `notification`, `upload`.
- Token masking, server-message parsing, and request/error debug logging helpers live in apiClient.js; reuse them rather than re-logging raw tokens.

### State (Redux Toolkit + redux-persist)
[redux/Store.js](redux/Store.js) persists the **entire** root reducer to AsyncStorage (key `root`). Reducers ([redux/RootReducer.js](redux/RootReducer.js)): `user`, `userAuth`, `attendance`, `quickAccess`, `notification`. The `REVERT_ALL` action ([redux/CommonActions.js](redux/CommonActions.js)) is handled by every slice via `extraReducers` to reset state on logout — dispatch it (through `clearStore`) rather than purging manually.

### Navigation ([navigation/](navigation/))
`Navigator` swaps `AuthNavigator` ↔ `AppNavigator` on `isLoggedIn`. **Navigation from outside React** (FCM handlers, interceptors) must go through [rootNavigation.js](navigation/rootNavigation.js): `navigateSafely(route, params)` checks readiness and queues a pending navigation if the tree/route isn't mounted yet, flushed by `NavigationContainer`'s `onReady`/`onStateChange`. Route names contain spaces (e.g. `"Attendance action"`, `"Leave request"`) — match them exactly.

### Push notifications ([services/notifications/fcm.service.js](services/notifications/fcm.service.js))
Uses `@react-native-firebase/messaging` (modular API). `registerBackgroundMessageHandler()` is called at module load in [App.js](App.js); `FcmBootstrap` runs `initializeFcm()` **only when logged in** and tears it down on logout. The service handles permissions (incl. Android 13 `POST_NOTIFICATIONS` and iOS APNS registration), token persistence, foreground/background/opened/initial-notification routing, backend token registration, **topic subscription sync** (diffed against `fcm_topics` in AsyncStorage via [utils/fcmTopics.js](utils/fcmTopics.js)), and unread-count sync into Redux. The backend registration method is configured in `app.json` → `expo.extra.fcmRegistrationMethod`.

### Attendance domain logic
[utils/attendanceSession.js](utils/attendanceSession.js) is pure, well-tested logic for resolving the active check-in session start time from noisy inputs (server status, persisted AsyncStorage time, Redux time) — it normalizes unix-seconds vs ms, rejects future/pre-checkout timestamps, and is the basis for the session timer. Location-restricted check-in ([attendance.service.js](services/api/attendance.service.js) `getOfficeLocation`/`userCheckIn`) uses `geolib` distance against `employee_locations`, gated by `restrict_location` / `unrestricted_checkout_location` flags cached in AsyncStorage.

### Styling
NativeWind (Tailwind v2) via `nativewind/babel` — `className` props work on RN components; content globs are `screens/`, `components/`, `pages/` only ([tailwind.config.js](tailwind.config.js)). Shared design tokens (`COLORS`, `SIZES`, `SHADOWS`) come from [constants/theme.js](constants/theme.js).

## Testing
Jest with `jest-expo` preset; setup in [jest.setup.js](jest.setup.js) mocks AsyncStorage, `expo-constants`, and `@react-native-firebase/messaging`. Tests live in `__tests__/` and focus on the high-risk pure/async logic (apiClient refresh, FCM handlers, attendance session/break rules) rather than UI rendering.

## Versioning gotcha
OTA compatibility depends on `expo.version` + manually pinned `expo.runtimeVersion` in `app.json` staying aligned with `package.json` `version` (all currently `1.1.8`). When bumping the app version, update both `app.json` fields. Note `constants/appInfo.js` exports a separate, stale `app_version` (`1.0.1`) — it is **not** the OTA source of truth.


## Implementation Workflow

When implementing a feature:

1. Understand existing screen patterns.
2. Search for similar functionality.
3. Reuse existing services when possible.
4. Reuse existing components before creating new ones.
5. Keep business logic in utils/services.
6. Keep screens focused on presentation.
7. Update tests when modifying critical logic.
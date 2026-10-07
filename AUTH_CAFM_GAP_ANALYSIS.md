# Auth SDK vs CAFM — Gap Analysis

Scope: the mobile/Auth SDK sign-in path of `claudion-checkin`, compared against
`CAFM_AUTH_REFERENCE.md` (CAFM `main@59ddd8c`, `@erpgulf/auth-sdk@0.1.2`). CAFM is
the behavioural reference for the **Auth SDK flow only**. The QR flow is this
app's production architecture and is not compared against CAFM (CAFM deleted its
QR login).

Sources read in full: `CAFM_AUTH_REFERENCE.md`; the installed SDK
(`node_modules/@erpgulf/auth-sdk@0.1.2`: `README.md`, `dist/index.js`); every
file listed in the classification below. At the original audit, runtime claims
about transports were verified against the then-installed
`react-native@0.81.5`, `whatwg-fetch` and `expo@54.0.37` sources, not inferred
from CAFM. The current flow and lifecycle descriptions below also cover the
subsequent Claudion authentication UI redesign; the gap table and result retain
the historical CAFM comparison.

Baseline before any change: full Jest suite 78 suites / 1,791 tests passing.

---

## Current Auth Architecture

Two independent sign-in methods converge on one session model:

```text
Unauthenticated (AuthNavigator: welcome | login | Qrscan | "mobile login")
│
├── QR flow (production)                    ├── Auth SDK flow (mobile)
│   Qrscan → parse QR → provisioning keys   │   "mobile login" → company code / server
│   login  → generate_token_secure          │   address → begin() → [sendOtp] →
│          → saveTokens                     │   complete() → profile + policy check →
│                                           │   provisioning keys → saveTokens
└──────────────┬────────────────────────────┴───────────────┬──
               ▼                                            ▼
   dispatch(setSignIn) — Redux `userAuth.isLoggedIn` (persisted) — Navigator swaps to AppNavigator
   Tokens: AsyncStorage access_token/refresh_token via apiClient.saveTokens (sole writer)
   Refresh: apiClient 401 → employee_app.gauth.create_refresh_token (both methods)
   Origin marker: AsyncStorage `auth_method` = "qr" (written at QR scan) | "mobile" (hand-off)
```

The methods share everything **after** a token is issued (token storage, refresh,
Redux session, navigator swap, logout, attendance policy cache). They share
nothing **before** it: the QR path never creates an SDK client, and the SDK path
never calls `generateToken` or reads `api_key`/`app_key`.

### File classification

| Classification | Files |
|---|---|
| `QR_ONLY` | `screens/QrScan.jsx`, `screens/QrScanLegacy.jsx`, `screens/QrScanModern.jsx`, `hooks/useQrScanner.js`, `screens/Login.jsx`, `screens/LoginLegacy.jsx`, `screens/LoginModern.jsx`, `hooks/useLogin.js`, `services/api/auth.service.js` (`generateToken`), `utils/loginError.js`, `__tests__/qrScanUi.test.jsx`, `__tests__/loginUi.test.jsx`, `__tests__/loginError.test.js` |
| `AUTH_SDK_ONLY` | `services/api/mobileAuth.service.js`, `hooks/useMobileLogin.js`, `screens/MobileLogin.jsx`, `utils/mobileAuthCrypto.js` (installed from shared `App.js`), `@erpgulf/auth-sdk`, `@erpgulf/server-lookup`, `__tests__/mobileAuthSession.test.js`, `__tests__/mobileLoginHook.test.jsx`, `__tests__/mobileLoginUi.test.jsx`, `__tests__/mobileAuthCrypto.test.js`, `__tests__/serverLookup.test.js` |
| `SHARED` | `App.js` (crypto install, FCM bootstrap, forced-logout cleanup), `navigation/navigator.jsx`, `navigation/auth-navigator.jsx`, `utils/provisioning.js` (`readInitialAuthRoute`; `readProvisioning` is QR semantics), `redux/Slices/AuthSlice.js`, `redux/Slices/UserSlice.js`, `redux/Store.js`, `services/api/apiClient.js` (`saveTokens`, `clearTokens`, `clearStore`, refresh, `plainAxios`), `services/api/authHelper.js`, `utils/authSessionGuard.js`, `screens/WelcomeScreen*.jsx`, `components/Welcome/SignInOptions.jsx`, `screens/Profile.jsx` (logout), `services/offline/attendanceConfigCache.js`, `services/api/attendance.service.js` (mobile policy branches), `services/offline/offlineCapability.js`, `utils/attendanceSessionState.js`, `utils/attendanceSession.js`, `services/notifications/fcm.service.js`, `__tests__/authProvisioning.test.jsx`, `__tests__/welcomeUi.test.jsx`, `__tests__/sessionResilience.test.js` |
| `UNRELATED` | Everything else, including `services/api/qr.service.js` and `screens/MyQrCode*.jsx` (the employee's attendance QR display, not QR sign-in) |

Storage ownership: `api_key`, `app_key`, `company` are QR-only (written by a scan,
removed only by a successful mobile hand-off). `backendUrl` is mobile-only.
`baseUrl`, `employee_code`, `employee_id`, `full_name`, tokens, `auth_method` and
the attendance-policy keys are shared.

## Protected QR Flow

What must not change:

- The QR payload parser (base64 → UTF-8, cleanup regexes, key extraction,
  `App_key` padding, `Photo` default) and its nine-key `AsyncStorage.multiSet`.
- `auth_method: "qr"` written at scan time; `invalidateAuthSession()` before the
  provisioning write; the four Redux dispatches; `navigate("login")`.
- `generateToken({ api_key, app_key, api_secret })` →
  `employee_app.gauth.generate_token_secure` with `x-skip-auth`, the refresh-token
  refusal, the generation guard and `saveTokens` as sole writer.
- Login's Yup schema, "QR code not scanned" guard, `employee_id` write,
  `setSignIn`, unread count, toasts — in both presentation variants.
- `readInitialAuthRoute`: complete QR provisioning opens `login` first.
- Restart: persisted `isLoggedIn` opens the app directly; no network gate.
- Logout keeps provisioning keys; forced logout only on terminal refresh rejection.
- No Auth SDK call, screen or storage write ever runs on the QR path.

# Protected QR Authentication Flow

```text
QR entry point     Welcome → SignInOptions "Scan QR code"; Login → "Scan QR code"; MobileLogin → "Scan QR code"
→ QR scan/read     QrScan → QrScanModern (useQrScanner) | QrScanLegacy (inline); camera or image picker
→ QR parsing       handleQRCodeData: base64/utf8 decode, KEY pairs, App_key padding, sanitize
→ server config    multiSet company, employee_code, full_name, api_key, app_key, baseUrl, photo,
                   restrict_location, unrestricted_checkout_location; auth_method = "qr"
→ authentication   Login → useLogin.handleLogin | LoginLegacy.handleLogin → generateToken → saveTokens
→ session          employee_id, setSignIn({ isLoggedIn: true, token }), unread count, toast
→ authenticated    Navigator: isLoggedIn → AppNavigator
```

| QR responsibility | File/function | Shared with Auth SDK? | Modification allowed? |
|---|---|---|---|
| Entry from Welcome | `components/Welcome/SignInOptions.jsx` (QR option), `screens/WelcomeScreen*.jsx` | Yes (same component lists the mobile option) | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Entry from Login | `screens/LoginLegacy.jsx`, `screens/LoginModern.jsx` (`navigate("Qrscan")`) | No | NO |
| Variant dispatch | `screens/QrScan.jsx`, `screens/Login.jsx` | No | NO |
| Camera / image scan | `hooks/useQrScanner.js` (`handleBarCodeScanned`, `pickImage`), `screens/QrScanLegacy.jsx` | No | NO |
| QR parsing + validation | `useQrScanner.handleQRCodeData`, `QrScanLegacy` inline copy | No | NO |
| Provisioning write | same functions: `multiSet` of 9 keys, `auth_method: "qr"`, `invalidateAuthSession()` | Keys shared (`baseUrl`, `employee_code`, `full_name`, policy flags); `api_key`/`app_key`/`company` QR-only | NO |
| Redux identity | `setUsername`, `setFullname`, `setBaseUrl`, `setEmployeeCode` (`UserSlice`) | Yes (actions reused by hand-off) | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Post-scan navigation | `navigation.navigate("login")` | No | NO |
| Password login | `hooks/useLogin.js` `handleLogin`; `screens/LoginLegacy.jsx` `handleLogin` | No | NO |
| Token exchange | `services/api/auth.service.js` `generateToken` | No | NO |
| Token persistence | `apiClient.saveTokens` (generation-guarded) | Yes (sole writer for both) | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Session publish | `AuthSlice.setSignIn`, `navigation/navigator.jsx` swap | Yes | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Login error copy | `utils/loginError.js` `getLoginErrorMessage` | No | NO |
| Initial route | `utils/provisioning.js` `readProvisioning`, `readInitialAuthRoute`; `navigation/auth-navigator.jsx` | Yes (mobile route is the second branch) | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Restart / restore | `redux/Store.js` persisted `isLoggedIn`; `apiClient` lazy token load | Yes | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Refresh / expiry | `apiClient.refreshAccessToken`, `expireSession` | Yes | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Logout | `screens/Profile.jsx` sign-out; `App.js` `registerSessionCleanupHandler` | Yes | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |
| Generation guard | `utils/authSessionGuard.js` | Yes | ONLY IF QR BEHAVIOR REMAINS IDENTICAL |

Policy for shared files: a change is allowed only with a stated reason why the QR
path executes identically. **This plan changes no shared file** (see
[Implementation Plan](#implementation-plan)).

---

# Auth SDK Analysis

## Auth SDK Flow

Current state machine (`hooks/useMobileLogin.js`, `utils/mobileAuthFlow.js`,
and focused step components inside the `screens/MobileLogin.jsx` auth shell).
All steps use the existing `"mobile login"` route:

```text
Hydrate backendUrl ─► MOBILE (company code | server address | remembered company) + mobile
Continue ─► [lookupServer] ─► client.begin({ mobileNumber }) (sessionActive omitted)
          ─► persist backendUrl ─► retain original SDK flow

SIGN_UP ─► sendOtp once ─► OTP (capture code in memory; not independently server-verified)
  ├─ password required ─► PASSWORD_CREATE ─► complete(flow, { otp, password })
  ├─ password optional ─► PASSWORD_OPTION
  │    ├─ Create password ─► complete(flow, { otp, password })
  │    └─ Skip for now ─► complete(flow, { otp }) (SDK managed-password behavior)
  └─ password disabled ─► complete(flow, { otp })

SIGN_IN ─► step derived from flow.credentials
  ├─ password only ─► PASSWORD_SIGN_IN ─► complete(flow, { password })
  ├─ OTP only ─► sendOtp once ─► OTP ─► complete(flow, { otp })
  └─ both ─► PASSWORD_SIGN_IN ─► capture password ─► sendOtp once ─► OTP
             ─► complete(flow, { password, otp })

Capability-based Create / Forgot password (SIGN_IN only; never reset on a both-factor flow)
  ─► OTP (send only if none attempted this flow) ─► PASSWORD_CREATE
  ─► setPasswordWithOtp({ mobileNumber, otp, newPassword })
  ─► confirmed success or unconfirmed outcome: discard flow ─► begin() (fresh policy)
  └► confirmed rejection: keep flow, return to the rejected credential's step

Authenticated completion ─► profile + complete attendance-policy validation
  ─► provisioning write, saveTokens, policy cache ─► setSignIn ─► AppNavigator
Back ─► previous step, same flow/cooldown, no automatic resend
Edit mobile / Change company / Cancel ─► discard flow and credentials ─► MOBILE
Manual Resend ─► sendOtp (cooldown = min(45 seconds, expiresIn))
```

SDK calls used: `createAuthClient`, `begin`, `sendOtp`, `complete`,
`setPasswordWithOtp`, `isAuthError`. Not used: `getLoginPolicy`, `signIn`, `signUp`,
`coldBoot`, `sessionActive`. Deprecated SDK factor alternatives are not used;
`PASSWORD_CREATE` is an app presentation step, not a replacement SDK flow.
Optional/Optional sign-in remains deterministic: the SDK resolves a user-known
password to password-only sign-in and no user-known password to OTP-only sign-in.
Only SDK-enabled credentials and capability-based password actions are exposed.
There is no independent OTP-verification API: sign-up and create/reset retain
the entered code only in transient flow state until final submission. Password
screens never request that code again, and no credential is persisted or placed
in navigation parameters.

## CAFM Reference Behavior

- One client per origin, 15 s timeout, metadata, and a **custom `expo/fetch`
  transport** enforcing `redirect:'error'`, `credentials:'omit'`, `no-store`;
  timeouts throw `AuthError('TIMEOUT')`, nothing logged or retried.
- `begin({ mobileNumber })` for new logins; the returned object is passed
  unchanged to `complete()`. UI from `nextStep`/`credentials`/`capabilities` only.
- OTP sent only when `otp.requirement === 'required'`, after `begin()`, never
  auto-retried; manual resend with a fixed **45 s** cooldown (server
  `otp_expires_in` unused).
- Password fields: `purpose: 'existing'` → single field; `purpose: 'create'` →
  create + **confirm**, **≥ 8 chars**, not blank-only. Blank optional password
  omitted so the SDK supplies a managed `egf_` password.
- Create/reset offered only on `SIGN_IN`, **never reset on `ENTER_PASSWORD_AND_OTP`**,
  never on cold boot. `setPasswordWithOtp` → `begin()` again on success **or an
  unknown outcome** (non-retryable `TIMEOUT|NETWORK_ERROR|SERVER_ERROR|INVALID_RESPONSE`).
- Errors by `code` only; `INVALID_OR_EXPIRED_OTP` clears the OTP field,
  `INVALID_PASSWORD` clears password + confirm.
- Cold boot: storage-only launch decision; `begin({ sessionActive: true })` gate
  when the stored cold-boot policy requires it.

## Gap Analysis (original CAFM audit)

The table records the original pre-fix comparison and required work. Its
single-screen and combined-field descriptions are historical; the current
Claudion presentation is the focused step flow described above. The CAFM
reference behavior remains unchanged.

Touch: `SDK` = `AUTH_SDK_ONLY`. No proposed change touches a `SHARED` or `QR_ONLY` file.

| Area | Current behavior | CAFM behavior | Classification | Required action | Touch |
|---|---|---|---|---|---|
| SDK version | `0.1.2` exact; no legacy beta fields | `0.1.2` exact | KEEP | — | — |
| Client initialization | Cached per origin, `timeoutMs: 15000`, metadata, HTTPS only | Same, `allowInsecureHttp: __DEV__` | KEEP / INTENTIONAL DIFFERENCE (HTTPS even in dev; documented, stricter) | — | — |
| SDK transport | None supplied → SDK `FetchTransport` → RN global `fetch` (whatwg-fetch/XHR). Verified: `redirect:'error'` **ignored** (XHR follows redirects, so a 307/308 replays the form body and master bearer); `cache:'no-store'` becomes a `_=` query param, no request header; `credentials:'omit'` honoured on RN 0.81 | `expo/fetch` transport enforcing all three | MISSING | Conforming `expo/fetch` transport, required lazily (this module loads at startup for QR users too) | SDK |
| Secure random | `App.js` installs `expo-crypto` before navigation; mobile hidden without it | Same | KEEP | — | — |
| `begin()` | `begin({ mobileNumber: trimmed })`; read-only; OTP afterwards | Same | KEEP | — | — |
| Non-cold-boot `CONTINUE_SESSION` | Not refused at `begin()`; unreachable (SDK throws `UNSUPPORTED_POLICY`); hand-off rejects `session_continued` | Refused at `begin()` | INTENTIONAL DIFFERENCE (same outcome) | — | — |
| Flow propagation | Same object from `begin()` held in hook state, passed to `complete()`; `flow.mobileNumber` reused for OTP/password calls | Same | KEEP | — | — |
| Policy handling | UI from `credentials`/`capabilities`; no raw policy reads | Same | KEEP | — | — |
| Password required | Existing purpose: single field; raw bytes sent | Same | KEEP | — | — |
| New password (create purpose, create/reset mode) | Single field; no confirmation; no length rule | Create + confirm; ≥ 8; not blank-only; mismatch error | MISSING | Confirm field + validator | SDK |
| Password optional | Blank omitted (SDK managed); whitespace-only silently dropped | Blank omitted; whitespace-only is an error | FIX | Apply create rules to any typed value | SDK |
| Password disabled | Hidden, never sent; SDK generates `egf_` | Same | KEEP | — | — |
| Existing-password behavior | Never inferred; flow-derived only | Same | KEEP | — | — |
| Managed passwords | App never generates/stores; requested dev diagnostics include the SDK-managed password; blank optional omitted | Same | KEEP | — | — |
| OTP send | After `begin()` iff required; never auto-retried; late results dropped | Same | KEEP | — | — |
| First OTP send fails | Flow kept, error shown, manual Resend | New login: flow discarded, Continue re-begins | INTENTIONAL DIFFERENCE (single-screen design; next send is still user-initiated) | — | — |
| Resend cooldown | Server `expiresIn` (commonly ~300 s lockout) | Fixed 45 s | FIX | `min(45 s, expiresIn)` (never outlives a short-lived code) | SDK |
| Password-panel OTP | Sent on entry only if none attempted in this flow | Always fresh on entry | INTENTIONAL DIFFERENCE (documented: avoids invalidating a delivered code; Resend now ≤ 45 s) | — | — |
| OTP verification | Inside `complete()` | Same | KEEP | — | — |
| Sign-in | `complete(flow, { password?, otp? })`; non-`authenticated` rejected | Same | KEEP | — | — |
| Rejected-field clearing | Nothing cleared | OTP cleared on `INVALID_OR_EXPIRED_OTP`; password(s) on `INVALID_PASSWORD` | MISSING | Clear in the error handler | SDK |
| Sign-up | Same path; OTP always sent; no help links | Same; "Create account" label optional | KEEP | — | — |
| Reset on `ENTER_PASSWORD_AND_OTP` | Offered when SDK `canResetPassword` | Never (OTP-only reset bypasses the password factor) | FIX | Gate in hook | SDK |
| Create/reset outside `SIGN_IN` | Capability-driven (SDK makes them false on sign-up) | Only `SIGN_IN` | FIX (defensive, same rule) | Gate in hook | SDK |
| Reset on OTP-only sign-in step | Offered (SDK capability true) | Hidden (CAFM quirk #5) | INTENTIONAL DIFFERENCE (SDK README sanctions it; sign-in is already OTP-only, no factor bypass) | — | — |
| Unknown password-change outcome | Error; old flow kept and submittable | Treat as changed, `begin()` again | FIX | Re-begin on unknown outcome, then explain | SDK |
| Password-change error copy | `INVALID_PASSWORD` → "password is incorrect"; `AUTHENTICATION_FAILED` → "Sign-in was not successful" | "That password can't be used" / "couldn't change your password" | FIX | Phase-aware copy | SDK |
| Cold boot | None | `/unlock` gate with `sessionActive: true` | INTENTIONAL DIFFERENCE — **not equivalent** when a tenant configures cold-boot re-auth; see [Cold Boot](#cold-boot-and-session-origin) | None: not enabled, by accepted decision | — |
| Session restoration | Persisted `isLoggedIn` + AsyncStorage tokens; reactive refresh; only terminal rejection logs out | Session+config pair; reactive refresh; refresh 401/403 logs out | INTENTIONAL DIFFERENCE / PROTECTED (shared with QR; equivalent semantics) | — | — |
| Persistence | Nothing before `complete()` except `backendUrl` after `begin()`; strict hand-off order with rollback | Nothing until success; config → session → workspace | INTENTIONAL DIFFERENCE (documented preference; stricter hand-off) | — | — |
| Token storage | AsyncStorage via shared `saveTokens` | SecureStore | PROTECTED_QR (shared with QR) | — | — |
| Identity mapping | Profile download, explicit attendance code | `employee.id` | INTENTIONAL DIFFERENCE (app-specific attendance identifier) | — | — |
| Navigation | No imperative navigation; navigator swap; mobile route gated by crypto | Same principle | KEEP | — | — |
| Logout | Shared logout; SDK client cache retained | `resetAuthClients()` | INTENTIONAL DIFFERENCE (master token is an unauthenticated, tenant-scoped service credential; nothing user-bound cached; avoids editing shared logout) | — | — |
| Error handling | Code-only copy; release diagnostics `{ code, httpStatus, retryable }`; development builds log unredacted SDK exchanges, credentials, resolved flow, and hand-off stages/errors for requested test-instance debugging | Code-only copy; dev-only `{ code, httpStatus, retryable }`; transport logs nothing | INTENTIONAL DIFFERENCE (dev-only diagnostics, requested for debugging) | — | SDK |
| Race conditions | Synchronous operation ref, operation identity for late results, generation guard, cancel on edit/company change | State-based disabling, flow identity | KEEP (stronger) | — | — |
| Dead code | OTP `optional` prop (resolved OTP is never optional); upper-cased requirement compare | — | REMOVE | Simplify | SDK |
| Discovery | `@erpgulf/server-lookup` / typed HTTPS origin; `begin()` validates the server | Directory + ping | INTENTIONAL DIFFERENCE (outside the SDK) | — | — |

## Critical Flow Lifecycle

```text
mobile number → begin() → returned flow → UI decision → credentials → complete() → OTP inside complete() → session
```

- **Preserved:** `activeFlow` is stored with `setFlow(activeFlow)` and read back
  as `flow` for `complete(flow, …)`; no clone, spread, serialization or route param.
- **Not recreated:** `begin()` runs for a new account flow and after a password
  change, including an unconfirmed outcome. Returning through Back/Continue to
  an unchanged account reuses the flow and OTP transaction.
- **Not lost between steps:** the hook retains the SDK flow, company, mobile,
  temporary credentials, and resend deadline across focused step screens under
  `"mobile login"`. Back never automatically resends. Leaving for QR, cancelling,
  editing mobile/company, or resetting authentication discards the flow and
  credentials; successful completion also clears them.
- **Passed where required:** `complete(flow, …)`; `sendOtp` and
  `setPasswordWithOtp` use `flow.mobileNumber`.
- **SDK-driven decisions:** step sequence from `credentials.*.requirement`,
  label/intent from `password.purpose`, OTP send from `otp.requirement`,
  password actions from `capabilities` (plus the `SIGN_IN` / Both-mode rule).
  Optional/Optional sign-in exposes the single SDK-selected method, respecting
  the employee's existing-password flag. Optional sign-up instead has a visible
  Create/Skip decision; Skip submits only OTP to `complete()`.
- **OTP capture versus verification:** no standalone verification method exists.
  Sign-up and password create/reset capture the code before the password step,
  then submit it once with the final credentials. Final OTP rejection returns
  to the OTP step without resending; password validation remains on its step.
- **Existing/managed passwords:** match CAFM; the app never generates, infers or
  sends a hidden password.
- **Gap:** after an unconfirmed `setPasswordWithOtp`, the stale flow stayed
  submittable. Fixed by re-beginning.

## Shared State Isolation

The SDK path cannot reach QR state before hand-off: lookup and `begin()` write
only `backendUrl`, and "Change company" removes only `backendUrl`. Hand-off is
the single intentional cross-over (documented): it validates identity and policy
first, then replaces QR provisioning, with generation-guarded rollback that never
overwrites a newer session. A QR scan invalidates the generation, so an in-flight
mobile hand-off aborts before writing. No new shared state is introduced.

## Navigation

QR routes (`Qrscan`, `login`, `welcome`) and the `"mobile login"` route stay
registered as before; nothing in this plan edits `auth-navigator.jsx`,
`navigator.jsx` or `readInitialAuthRoute`. The SDK flow never navigates on success
and never redirects into QR routes except the user-pressed "Scan QR code".
Focused auth steps use local hook state under `"mobile login"`, with no raw OTP
or password in route parameters. Visible Back and native back navigation follow
the same step sequence; leaving the route cancels its transient flow.

## Cold Boot and Session Origin

Decision (accepted; not enabled at this time):

> CAFM supports Auth SDK cold-boot reauthentication. This application intentionally does not currently enable it because application startup may occur for background attendance/geofence execution. Session validity continues to be handled by the existing token refresh/session resilience layer.

This guarantees:

- QR authentication is unchanged, and QR-created sessions never enter Auth SDK
  cold boot.
- Startup never calls `begin({ sessionActive: true })`, so a background or
  geofence launch never triggers interactive reauthentication.
- Signed-in sessions of either origin restore from the persisted `isLoggedIn`
  and stored tokens, and `apiClient` refreshes them on 401.
- A terminal refresh rejection uses the existing `expireSession` → `clearStore`
  transition back to the auth navigator, which reopens `login` (QR
  provisioning) or `"mobile login"` (mobile).

Known consequence: a tenant's `cold_boot_policy` is not enforced for mobile
sessions. If this is revisited, origin is distinguishable (`auth_method ===
"mobile"`; `"qr"` or absent for QR), and the gate would need `flow.mobileNumber`
and `flow.policy.coldBootPolicy` persisted at hand-off.

## Logout

Both methods share `Profile` logout and `apiClient.expireSession`, which keep
QR provisioning and queued attendance. CAFM's extra step (`resetAuthClients`)
only drops cached master tokens; they are unauthenticated tenant credentials
holding nothing user-specific. Shared logout stays unchanged.

## Implementation Plan

| # | Change | File (classification) | QR regression risk |
|---|---|---|---|
| 1 | `expo/fetch` transport (`redirect:'error'`, `credentials:'omit'`, `Cache-Control: no-store`, own timer → `TIMEOUT`, cause-less `NETWORK_ERROR`, every status returned, no retries, requested unredacted test-instance diagnostics in development builds only); lazy `require` so a missing native module surfaces as `NETWORK_ERROR`, never a startup crash | `services/api/mobileAuth.service.js` (AUTH_SDK_ONLY) | None: only SDK clients use it; module import has no new side effect |
| 2 | Resend cooldown `min(45 s, expiresIn)` | `hooks/useMobileLogin.js` (AUTH_SDK_ONLY) | None |
| 3 | Create/reset only on `SIGN_IN`; no reset on `ENTER_PASSWORD_AND_OTP`; hook exposes `canCreatePassword`/`canResetPassword` | `hooks/useMobileLogin.js`, `screens/MobileLogin.jsx` (AUTH_SDK_ONLY) | None |
| 4 | Unknown `setPasswordWithOtp` outcome → discard flow, `begin()` again, explain | `hooks/useMobileLogin.js` | None |
| 5 | New-password rules (confirm, ≥ 8, not blank-only) for create-purpose fields and create/reset | `hooks/useMobileLogin.js`, `screens/MobileLogin.jsx` | None |
| 6 | Clear rejected OTP/password fields; phase-aware password-change copy | `hooks/useMobileLogin.js` | None |
| 7 | Remove dead OTP-optional rendering and upper-case compare | `screens/MobileLogin.jsx` | None |
| 8 | Regression tests for 1–7; docs (`AGENTS.md`, `CLAUDE.md`, `docs/mobile-sign-in.md`) updated where they described the old transport/cooldown | tests (AUTH_SDK_ONLY), docs | None |

QR regression check: run `qrScanUi`, `loginUi`, `welcomeUi`, `authProvisioning`,
`sessionResilience` and the full suite; the final diff must contain no `QR_ONLY`
or `SHARED` code file.

## Result

- Implemented items 1–8. Code changes are confined to `mobileAuth.service.js`,
  `useMobileLogin.js` and `MobileLogin.jsx`; tests to the three mobile suites.
- Full Jest suite: 78 suites / 1,805 tests passing (baseline 1,791 plus 14 new).
  Against the pre-change source, 19 of the new or updated tests fail, so each
  detects its gap.
- Production Metro export succeeds for iOS and Android; both Hermes bundles
  contain the `expo/fetch` module and the transport.
- Diff audit: no `QR_ONLY` file and no `SHARED` code file changed.
- Not verified here: a live staging backend (see `docs/mobile-sign-in.md`).
  The credential steps cannot be reached on a simulator without one, so the new
  confirm field was checked with React Native Testing Library only.

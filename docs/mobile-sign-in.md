# Mobile sign-in

Employees can choose the existing QR/password method or mobile sign-in, and
the app presents them at equal weight: both Welcome variants show the two as
matching option cards, and both password Login variants offer QR rescan and
mobile as matching alternatives below Login.
The new screen uses the SDK's resolved credential requirements for password,
OTP, optional password creation, and password reset. It never starts cold-boot
reauthentication during app launch or background geofence relaunch.

Dependencies are `@erpgulf/auth-sdk@0.1.2`, `@erpgulf/server-lookup@1.0.0`, and
Expo SDK 54's `expo-crypto@~15.0.9`. Both ERPGulf packages ship ESM; Jest maps
their published entry points and transforms them. Expo's own UTF-8 TextDecoder
is exercised by the sealed-token regression test.

## Company lookup configuration

Set these build/development environment variables through local `.env.local`
or the selected EAS environment:

- `EXPO_PUBLIC_SERVER_LOOKUP_URL`
- `EXPO_PUBLIC_SERVER_LOOKUP_SECRET`
- `EXPO_PUBLIC_SERVER_LOOKUP_ALPHABET`

Keep deployment values out of source control and diagnostic output. The hook
passes literal `process.env.EXPO_PUBLIC_*` property accesses to `lookupServer`
only when lookup is actually needed. Established company selections work
without lookup configuration or an available lookup service.

In `.env` files, escape a literal dollar sign as `\$`; quoted values still go
through Expo's dotenv expansion. EAS environment variables use the plain `$`.
After changing these variables, restart with `npx expo start -c`.

Company codes are normalized and validated with the package's helpers, kept
only in screen memory, and sent in one lookup attempt with the package's
15-second timeout. There is no retry or cache. SDK client creation enforces
HTTPS origins. Invalid lookup responses, including an HTTP URL or a URL the SDK
rejects, use the app's support message.

Instead of a company code, the employee can switch the form to **Server
address** and type it. The address is normalized and validated with the
package's `normalizeBackendUrl`/`validateBackendUrl`, refused at the field
unless it is HTTPS, and reduced to its origin, so a pasted desk link such as
`/app/home` still works. It skips the lookup and its configuration entirely and
is persisted exactly like a looked-up URL. Connection and backend-shape
failures on this path say the server could not be reached at that address,
rather than blaming the setup service.

`backendUrl` is the mobile company preference. It is saved only after a successful
SDK `begin()`, and skips future lookup. “Change company” clears this preference
and the active form. Existing QR provisioning and canonical `baseUrl` remain
intact until mobile session hand-off succeeds.

## SDK transport and credentials

SDK requests use an `expo/fetch` transport in `mobileAuth.service.js`. React
Native's global fetch silently follows redirects despite the SDK's
`redirect: "error"`, which could replay the form body and master bearer token.
The transport also omits cookies, sends `Cache-Control: no-store`, returns every
HTTP status to the SDK, and reports failures as cause-free `TIMEOUT` or
`NETWORK_ERROR`. It is required lazily, so loading the module at startup (which
QR users also do) cannot fail on the native fetch module.

Development builds log every SDK exchange as `[auth-sdk] METHOD URL → status`
with its request and response, plus the flow `begin()` resolved
(`[auth-sdk] flow`). `access_token`, `refresh_token`, `password`,
`new_password` and `otp` are masked as `***`; a failed request logs only
`TIMEOUT` or `NETWORK_ERROR`, never the native error. Release builds log none
of it. Read them in the Metro terminal or with `adb logcat -s ReactNativeJS`.

Resend is manual, with a 45-second cooldown, or the code's `expiresIn` when
that is shorter. A password the employee chooses (sign-up, create, reset) needs
a matching confirmation, at least 8 characters, and not only spaces. An
untouched optional sign-up password is omitted, so the SDK sends a managed one.
Create/reset is offered only on `SIGN_IN`, and reset never on
`ENTER_PASSWORD_AND_OTP`, where a code-only reset would bypass the password.
After `setPasswordWithOtp`, including an outcome the SDK cannot confirm, the
old flow is discarded and `begin()` runs again. A rejected OTP or password is
cleared from its field. `AUTH_CAFM_GAP_ANALYSIS.md` lists the remaining
deliberate differences from the CAFM reference, including the absence of
cold-boot re-authentication.

## Authentication modes

The backend sends one policy triple per tenant mode. The SDK resolves it
against the employee's state, and the screen renders only the resolved
credentials; it never reads the raw policy. `authFlowMatrix.test.js` pins this
end to end.

| Mode | Backend policy: sign-up password · sign-in · cold boot (password / OTP) | Sign-up | Sign-in | Cold boot |
| --- | --- | --- | --- | --- |
| Password | Mandatory · Mandatory / No · Mandatory / No | new password + code | password | password |
| OTP | No · No / Mandatory · No / Mandatory | code | code | code |
| Optional | Optional · Optional / Optional · Optional / Optional | code + optional new password | password if the employee has one, otherwise code | as sign-in |
| Both | Mandatory · Mandatory / Mandatory · Mandatory / No | new password + code | password + code | password |

Sign-up OTP is always Mandatory. There is no Skip button: an optional new
password is labelled Optional and may be left empty, and the code is still
required. A required password, including an Optional-mode employee's existing
one, cannot be skipped, and a code cannot replace it. Cold boot is listed for
completeness; the app does not run it.

## Identity and attendance hand-off

`completeMobileSignIn` invalidates the previous auth generation before calling
SDK completion, rejects missing refresh tokens and stale responses before
writes, and uses `saveTokens` as the sole token writer. All identity actions
precede `setSignIn`; the existing unread-count fetch and success toast follow.
The QR `useLogin` implementation is unchanged.

The authenticated employee-policy response must explicitly supply a Frappe
docname (`name` or `employee`) matching an SDK employee field, a display name
(`employee_name`), and the QR attendance identifier (`employee_code` or
`employee_field_value`). Conflicting or absent identifiers are rejected. SDK
`id` is used only as the initial profile lookup candidate, never assumed to be
the QR employee code. This conservative contract needs validation against the
actual tenant; it is not evidence that the published SDK's backend contract
works on a live server.

Before any provisioning changes, the app downloads and validates explicit
`restrict_location`, `unrestricted_checkout_location`, and `photo` flags.
Restricted employees also need a usable reporting location and positive radius.
It then writes `baseUrl`, `employee_code`, `employee_id`, and `full_name`, saves
tokens, and awaits the scoped attendance cache and legacy mirrors before
publishing the authenticated UI. Later mobile policy refreshes also reject
partial data; missing restriction mirrors refuse manual attendance.

Successful mobile hand-off removes QR `api_key`/`app_key`, stale `company`, and
the previous username. Employees rescan to use QR again. Same-tenant attendance
sessions and queued records are preserved; a tenant change clears the previous
tenant's session record without deleting queued punches. A persistence failure
clears the failed credentials and restores the previous provisioning when its
generation is still current. Cleanup never rolls back over a newer session.

`auth_method` stores `qr` or `mobile`. Full QR provisioning takes priority when
choosing the unauthenticated route; otherwise the last mobile method and a
remembered URL open mobile sign-in. Older binaries without secure random values
continue to offer the QR method.

## Native release and required live checks

Release fields are version/runtime `1.2.1`, iOS build `13`, and Android
versionCode `22`, including the committed iOS plists. `ExpoCrypto` requires a
new native build; an OTA update alone does not install it. Its guarded startup
load prevents older binaries from crashing and hides their mobile option.

Local tests use synthetic credentials, keys, alphabets, employee data, and SDK
transport responses. The project scan did not locate a confirmed staging tenant
with disposable employees. Before rollout, supply that setup and verify:

- QR and mobile/password sign-in, plus an OTP-only tenant on both platforms.
- SDK-generated passwords, sent with the OTP when the policy has no password
  or an Optional employee has none: the backend accepts them, and
  `employee_has_existing_password` stays `false`, or the next sign-in asks for
  a password the employee never saw.
- The SDK employee fields, canonical Frappe docname, and the exact identifier
  already stored as QR `employee_code`, including an existing queued employee.
- The employee profile response contract and fail-closed attendance flags.
- SDK refresh tokens with the existing
  `employee_app.gauth.create_refresh_token` endpoint. An incompatibility blocks
  rollout; no alternate refresh path is implemented.
- Password create/reset, manual resend cooldown, logout/expiry route selection,
  and location checks before the first attendance submission.

Native/Metro builds and mock-based tests do not substitute for these live checks.

## Local verification

The pre-change baseline passed 73 Jest suites and 1,675 tests. This checkout
already excludes `.git-rewrite` from Jest's test paths; the snapshot still
produces a package-name collision warning. Lint remains unavailable because
the repository has no ESLint configuration. Jest was run with `--watchman=false`
and `--forceExit` to accommodate the existing Watchman/open-handle limitations.
The final full suite passed 78 suites and 1,782 tests, including real SDK
transport fixtures for password and OTP-only hand-off, rollback and stale-session
checks, and sealed lookup tokens decoded with Expo's TextDecoder. Recovery also
requires manual Resend after an unconfirmed OTP attempt.

Production Metro exports passed for iOS and Android. CocoaPods includes
`ExpoCrypto` 15.0.9, and both native debug builds passed with the bumped version
fields. The iOS build used the command-line override
`IPHONEOS_DEPLOYMENT_TARGET=15.1` to accommodate the current Xcode toolchain's
rejection of older resource-pod targets; no pod deployment settings were changed
in the repository.

Fresh iOS and Android simulators showed both sign-in choices and the company-code
form in light and dark themes. iOS also exercised native secure random values
and Expo's UTF-8 decoder in Hermes. An existing development notification warning
was dismissed for the iOS screen captures; Android's captured error log was
empty. These smoke checks did not submit lookup requests or credentials.

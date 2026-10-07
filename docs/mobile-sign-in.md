# Mobile sign-in

Employees can choose the existing QR/password method or mobile sign-in, and
the app presents them at equal weight: both Welcome variants show the two as
matching option cards, and both password Login variants offer QR rescan and
mobile as matching alternatives below Login.
The unchanged `"mobile login"` route uses a themed auth shell with focused
mobile/account, OTP, password sign-in, and password creation steps. Each step
uses the SDK's resolved credential requirements. It never starts cold-boot
reauthentication during app launch or background geofence relaunch.

Dependencies are `@erpgulf/auth-sdk@0.1.2`, `@erpgulf/server-lookup@1.0.0`, and
Expo SDK 57's `expo-crypto@~57.0.3`. Both ERPGulf packages ship ESM; Jest maps
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

Development builds (`__DEV__`) log SDK request URLs, response statuses, duration,
request IDs, and policy/flow metadata under `[auth-sdk]`. `[mobile-auth]` traces
screen changes, operations, employee/profile downloads, identity and attendance
validation, token storage stages, session publication, and rollback.
`employee.identity.verified` names the matching identifier class;
`employee.identity.rejected` gives the rejection reason and normalized IDs.
`handoff.failed` names the failing stage; `employee.failed` includes status,
timing, and error codes. The logger omits tokens, passwords, managed passwords,
OTPs, authorization headers, raw request/response payloads, and free-text errors
or stacks that could contain credentials. Diagnostics never retry requests or
write credentials to storage.
Release builds omit these logs and retain only `{ code, httpStatus, retryable }`
failure diagnostics. Read development logs in the Metro terminal or with
`adb logcat -s ReactNativeJS`.

Resend is manual, with a 45-second cooldown, or the code's `expiresIn` when
that is shorter. A password the employee chooses (sign-up, create, reset) needs
a matching confirmation, at least 8 characters, and not only spaces. Choosing
**Skip for now** during optional sign-up omits the password, so the SDK sends a
managed one.
Create/reset is offered only on `SIGN_IN`, and reset never on
`ENTER_PASSWORD_AND_OTP`, where a code-only reset would bypass the password.
After `setPasswordWithOtp`, including an outcome the SDK cannot confirm, the
old flow is discarded and `begin()` runs again. A rejected OTP or password is
cleared from its field. `AUTH_CAFM_GAP_ANALYSIS.md` lists the remaining
deliberate differences from the CAFM reference, including the absence of
cold-boot re-authentication.

## Focused authentication steps

The mobile/account step keeps company selection and mobile entry together;
it contains no OTP or password fields. After `begin()`, explicit step state
renders the next screen while retaining the original SDK flow, company, and
mobile context in memory. Navigation does not call `begin()` or send OTP again.

Sign-up always starts with the standalone OTP step. If the resolved password
purpose is `create`, entering a nonblank code advances to a separate password
screen. Required passwords show **Create password** without a Skip action.
Optional passwords show both **Create password** and a visible secondary
**Skip for now** button. Disabled passwords finish from the OTP screen.

The installed SDK has no independent OTP-verification operation. For sign-up
with a password decision, the first step captures the code; server verification
happens when `complete(originalFlow, { otp, password })` or
`complete(originalFlow, { otp })` is submitted. The employee enters the code
once. Create/reset similarly captures it before the separate new-password
screen and submits it through `setPasswordWithOtp`. A final OTP rejection
returns to the OTP step so the employee can correct the code or manually resend.
These transitions do not claim that an intermediate code was server-verified.

OTP-only sign-in finishes from the OTP screen. Password-only sign-in uses a
dedicated password screen. When the SDK requires both credentials, sign-in
captures the password first, then sends OTP once and opens the OTP screen;
completion submits both credentials together. The SDK selects a single sign-in
factor for an Optional password / Optional OTP policy: an employee with a
user-known password gets password sign-in; an employee without one gets OTP.
The app offers the method allowed by resolved `credentials`, plus separate
capability-based create/reset actions, and does not invent an OTP alternative
for a password-only resolved flow.

Back moves between steps without sending another code. Returning to OTP from
a sign-up password decision reuses the existing flow and cooldown. Cancelling
the flow, changing company or mobile number, or resetting authentication clears
temporary credentials and invalidates stale operations. Successful completion
also clears them. Raw OTPs and passwords remain in transient hook state only;
they are never written to AsyncStorage, SecureStore, or persisted Redux state.

## Authentication modes

The backend sends one policy triple per tenant mode. The SDK resolves it
against the employee's state, and the screen renders only the resolved
credentials; it never reads the raw policy. `authFlowMatrix.test.js` pins this
end to end.

| Mode | Backend policy: sign-up password · sign-in · cold boot (password / OTP) | Sign-up | Sign-in | Cold boot |
| --- | --- | --- | --- | --- |
| Password | Mandatory · Mandatory / No · Mandatory / No | code → create password | password | password |
| OTP | No · No / Mandatory · No / Mandatory | code | code | code |
| Optional | Optional · Optional / Optional · Optional / Optional | code → create password or Skip for now | password if the employee has one, otherwise code | as sign-in |
| Both | Mandatory · Mandatory / Mandatory · Mandatory / No | code → create password | password → code | password |

Sign-up OTP is always Mandatory. Only an optional new sign-up password can be
skipped. The SDK handles its managed-password behavior when the app submits only
the captured OTP. A required password, including an Optional-mode employee's
existing one, cannot be skipped, and a code cannot replace it. Cold boot is
listed for completeness; the app does not run it.

## Identity and attendance hand-off

`completeMobileSignIn` invalidates the previous auth generation before calling
SDK completion, rejects missing refresh tokens and stale responses before
writes, and uses `saveTokens` as the sole token writer. All identity actions
precede `setSignIn`; the existing unread-count fetch and success toast follow.
The QR `useLogin` implementation is unchanged.

Identity verification first compares trimmed, case-sensitive SDK `employee.id`
and fetched `name`. An exact match verifies identity without requiring an
attendance code; a mismatch rejects immediately, regardless of secondary codes.
Conflicting fetched `name` / `employee` aliases or `employee_code` /
`employee_field_value` codes also reject. Explicit attendance codes are preserved;
when absent after a canonical match, the verified docname supplies the app's
employee identifier. Verify that the tenant's attendance endpoints accept this
identifier before rollout.

When a canonical field is absent, fallback retains the fetched docname alias
and explicit-code checks. It compares that docname with SDK `id`, or the existing
SDK-validated `flow.policy.employeeId` if `id` is absent. No trusted match means
rejection. The installed SDK normally requires `id` on successful authentication;
policy fallback does not bypass its response validation. Display names and phone
numbers never prove identity. `employee_name`, `first_name`, and SDK `name` are
used only for display, falling back to the verified docname if needed.

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

## Earlier SDK integration verification

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

## Authentication UI verification (2026-10-07)

The step redesign passed all 83 Jest suites and 1,904 tests, using
`--runInBand --watchman=false --forceExit`. `mobileAuthSteps` exercises real SDK
policy resolution and completion against synthetic transport responses;
`mobileLoginNavigation` combines the real hook and SDK with focused screens
and a mocked native stack. These cover Create/Skip, mandatory and disabled
passwords, both-factor sign-in, recovery, invalid credentials, manual resend,
back navigation, company/mobile changes, and credential cleanup. Route-blur
tests also verify that cancelled operations cannot complete and that a
successful Redux hand-off is not invalidated while notifications are pending.
Presentation tests cover light/dark themes and Arabic/RTL.

Production Metro exports passed for Android and iOS without new dependencies.
The redesigned native stack, keyboard/autofill behavior, and gestures have not
been exercised on devices in this change; neither have live backend calls.
Manually check code expiry while choosing a password, resend after correction,
Skip followed by logout/OTP sign-in, password create/reset, native back, company
switching, and QR hand-off on disposable staging employees before rollout.

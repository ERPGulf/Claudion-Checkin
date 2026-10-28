# Geotagging permission onboarding

Before the app asks the operating system for location access for automatic
attendance, it shows a full-screen explanation. The explanation covers what
automatic attendance does, why each permission is needed, and what to choose at
each system prompt. It appears once per account, and only to employees whose
employer has turned on automatic attendance. Every later change goes through
the Automatic attendance screen.

It replaces the plain two-button `Alert` that the shared permission flow used to
show. There is still one permission flow. The explanation is a step inside it,
not a second permission system.

## Architecture

```
AutoAttendanceOnboarding (App root)          useAutoAttendance (Automatic attendance screen)
  └─ when due, once per account                 └─ "Grant location access" (fromTap)
            │                                               │
            └────────────► askForLocationAccess ◄───────────┘   utils/autoAttendance.js
                             single flight: callers join one flow
                             1. readLocationAccess()       OS state, every time
                             2. granted → done; blocked → Settings (tap only)
                             3. explainer(access, requestLocationAccess)
                                  └─ LocationAccessExplainer (registered by the onboarding host)
                                       Continue → requestLocationAccess(): foreground, then background
                                       Not now / Back (Android) → false
                                       not shown / session or config changed → null
```

- **`askForLocationAccess`** ([utils/autoAttendance.js](../../utils/autoAttendance.js))
  is unchanged in shape. It is still single-flight, so a re-render, a refresh or
  the screen's button joins the running flow instead of stacking dialogs. It
  still returns the access state read back from the OS plus `asked` (whether
  the employee answered the explanation). Only the explanation step changed.
  It used to be an `Alert`; it is now whatever `setLocationAccessExplainer`
  registered.
- **`LocationAccessExplainer`**
  ([components/AutoAttendance/LocationAccessExplainer.jsx](../../components/AutoAttendance/LocationAccessExplainer.jsx))
  is the registered explanation. `AutoAttendanceOnboarding` renders it at the
  app root, so it serves the onboarding and the screen's button alike. On
  Continue it runs the permission requests itself and stays visible until they
  finish. Each system prompt therefore appears over the step that describes it,
  rather than over a half-dismissed screen.
- **`describeLocationAccessSteps(access)`** is the pure, platform-aware list of
  missing steps the explanation renders.
- **`AutoAttendanceOnboarding`**
  ([components/AutoAttendanceOnboarding.jsx](../../components/AutoAttendanceOnboarding.jsx))
  decides *when* the flow starts by itself.
- Registration with the geofence is untouched. `AutoAttendanceBootstrap`
  remains the single registrar. A grant only dispatches
  `requestAutoAttendanceSync()` so that the bootstrap re-runs its startup
  sequence.

## Eligibility

The explanation follows the existing employer configuration exactly
(`selectAutoAttendanceConfigured`). This change adds no new rule.

| Tenant `attendance_action.geo_tagging` | Employee `geotagging` | Onboarding |
| --- | --- | --- |
| anything but boolean `true` (false, 0, null, missing, `"true"`) | any | never |
| `true` | 0, missing or malformed | never |
| `true` | 1 (warnings only) | never — see below |
| `true` | 2 (all actions) | once, if location access is missing |

**Warnings-only (1) shows no onboarding.** Mode 1 is never monitored, never
punches, and is never asked for location. The backend defines no warning
behaviour for it, and manual attendance never reads it. There is no permission
for it to explain, so warnings-only copy would only promise warnings the app
does not give. A warnings-only variant of the explanation exists for the
Profile preview (below), with no background step. When the backend defines
mode 1, decide its real permission needs and wire it into the onboarding.

The flow starts by itself only when all of the following hold:

1. The employee is signed in, and the account is configured as in the table.
2. Both the tenant settings and the employee policy were received for this
   account (`tenant::employee` scope) since this launch. Persisted answers may
   have been withdrawn, so they never start it, and loading or unknown
   configuration never counts as enabled.
3. The app is in the foreground, so a geofence relaunch never prompts.
4. The OS reports access missing and still askable.
5. This account has not answered the explanation before.

## Presentation and copy

The explanation is a full-screen modal. Continue can lead through up to two
system prompts, plus a settings page on Android 11+, so a full screen gives room
for every step and keeps them visible behind the prompts. It slides up, or
fades when Reduce Motion is on. It uses the design system's tokens through
`useAppTheme()` in both palettes, and its content scrolls while the actions stay
pinned.

| Part | Copy |
| --- | --- |
| Title | Make attendance easier |
| Disclosure | Your employer has turned on automatic attendance. This app uses your location to record your attendance at your assigned workplace, even when the app is closed or not in use. |
| Benefits | Checked in as you arrive · Checked out as you leave · Kept when you're offline (only while the employer's `offline_attendance` switch is on and the server is not known to lack the offline endpoint) |
| Steps ("You'll be asked for") | Only the missing ones: **Precise location** (so the app knows when you're at your workplace) and **Background location** (so attendance works while the app is closed), each with what to choose |
| Footnote | Without it, you check in and out yourself. Battery saving can delay automatic attendance. You can change access at any time in Settings. |
| Actions | iOS: **Continue**. Android: **Continue**, **Not now** |

The disclosure sentence is Google Play's prominent disclosure for background
location. It names the data, the use, and "even when the app is closed or not in
use", and it appears before any request. No button says "Allow" or "Enable",
because pressing it only opens the system prompt.

Accessibility: the title and section are headers. Each row is a single
screen-reader stop that reads its title, purpose and instruction. The decorative
icon is hidden from screen readers. Text scales with the system size, the
layout uses logical start/end properties for RTL, and the modal confines
VoiceOver and TalkBack focus on both platforms.

## Development preview

Development and `preview`-channel builds show a **Location explanation test**
panel on Profile ([LocationOnboardingTestSetting](../../components/settings/LocationOnboardingTestSetting.jsx)).
It has two buttons:

- **Automatic attendance (mode 2)** shows the production explanation.
- **Warnings only (mode 1)** shows the preview-only variant: "Enable
  location-based attendance", which never promises automatic check-in or
  check-out, with only the Precise location step.

Both open the explanation whatever the account's configuration, as if no access
had been given. Continue, Not now and Back only close it: nothing is requested
and nothing is recorded. A preview never replaces an explanation waiting for an
answer, and a real explanation that becomes due replaces an open preview.
Production builds render nothing. The entry point is
`previewLocationAccessExplanation(mode)` in `utils/autoAttendance.js`.

## Permission sequence

On Continue, the existing `requestLocationAccess` runs:

1. Foreground location, if it is missing, or on Android if it was granted only
   approximately.
2. Background location, once foreground is granted.
3. The state is read back from the OS. A request result is never trusted;
   asking for "Always" does not mean it was given.

The prompts run one at a time, and only from the employee's tap. If the system
will no longer ask (`blocked`), onboarding shows nothing. The screen's button
then offers Settings, and only from a tap. A granted result dispatches
`requestAutoAttendanceSync()`. Any answer records the account as answered.

Notifications are not part of this flow. FCM already asks at every sign-in for
push, and the automatic check-out alert reuses that permission. Without it the
alert is skipped and attendance is unaffected. No battery-optimisation
exemption is requested.

## Persistent state

`autoAttendance.locationOnboarding` maps each `tenant::employee` scope to
`true` once the explanation has been answered (Continue or Not now).
`declinedLocationAccess`, which re-asked whenever the OS state changed, has been
replaced.

- It persists with the root reducer and survives sign-out (`REVERT_ALL`). It is
  keyed per tenant and employee, so it never reaches another account, including
  the same employee ID on another tenant.
- It gates only the *automatic* presentation. Permission is always read from
  the OS. Access revoked later shows as "Location permission required" on the
  Automatic attendance screen, whose "Grant location access" explains again on
  request.
- It is forgotten (`locationOnboardingReset`) when a verified answer makes the
  account ineligible (employee mode not 2, or tenant switch off). Becoming
  eligible again is then evaluated afresh.
- If the explanation closes without an answer, nothing is recorded and the
  next foreground re-evaluates. This happens on sign-out, on an employer change
  while it is open, or when it could not be shown.

Anyone who answered yesterday's `Alert` on a preview build will see the
explanation once more, because that record was renamed.

## iOS and Android

| | iOS | Android |
| --- | --- | --- |
| Actions | Continue only. Apple's guidelines rule out leaving a pre-alert screen without seeing the system alert, and that alert has its own "Don't Allow" | Continue and Not now. Back means Not now; navigating away is never consent (Google Play) |
| Foreground | "Allow While Using App", with Precise on | "Precise" and "While using the app"; approximate-only is asked again |
| Background | "Change to Always Allow" | API 30+: the system opens the app's location settings ("Allow all the time"). API 29: "Allow all the time". API ≤28: no separate step |
| Precise later | Settings only (`blocked`), so never auto-shown | Asked again with the foreground request |
| Presentation | A modal cannot present over another modal. If the explanation is not shown within 3 s, it closes unanswered and the flow is freed | Dialog windows stack; edge-to-edge with matching status-bar icons |

expo-location reports iOS "Always" as askable again after every relaunch, but
iOS offers the upgrade prompt only once. The once-per-account record keeps the
onboarding from promising a prompt that will not come. On the screen's button,
the first tap after that can end without a prompt, and the next tap offers
Settings.

## Files

| File | Change |
| --- | --- |
| `components/AutoAttendance/LocationAccessExplainer.jsx` | New: the explanation, with the preview-only mode-1 copy |
| `components/settings/LocationOnboardingTestSetting.jsx`, `screens/Profile.jsx` | New: the development preview panel on Profile |
| `components/AutoAttendanceOnboarding.jsx` | Once per account, verified-scope freshness, re-eligibility reset; hosts the explainer |
| `utils/autoAttendance.js` | `setLocationAccessExplainer`, `describeLocationAccessSteps`, `previewLocationAccessExplanation`; `Alert` explainer, `locationAccessKey` and `unless` removed |
| `redux/Slices/AutoAttendanceSlice.js` | `locationOnboarding`, `locationOnboardingAnswered`, `locationOnboardingReset`, `selectLocationOnboardingAnswered` (replace the declined-state record) |
| `hooks/useAutoAttendance.js` | The screen's button records an answered explanation |
| `__tests__/autoAttendanceOnboarding.test.jsx` | Rewritten against the real explanation UI |
| `__tests__/autoAttendanceSlice.test.js`, `__tests__/autoAttendanceHookCapability.test.jsx` | Updated for the record and the explainer seam |
| `CLAUDE.md` | Automatic attendance section |

## Regression tests

`npx jest __tests__/autoAttendanceOnboarding.test.jsx` covers:

- Never shown, checked or requested when the tenant is off (false, 0, null,
  `"true"`, missing), the employee is 0, warnings-only (1), malformed or
  missing.
- Shown for mode 2 with the automatic copy and only the missing steps. iOS has
  no Not now. Nothing is requested before Continue.
- Waits for both answers since launch, and ignores persisted ones. The offline
  benefit follows the employer's switch.
- Continue runs foreground then background once, with the explanation behind
  them. A grant triggers registration and is recorded. The state is verified
  after asking. A declined prompt is recorded and never re-prompted. Nothing is
  shown when access is granted or blocked, or for iOS approximate-only.
- Android: Not now and Back record an answer with no prompt. Approximate-only
  asks again. The steps are correct for API 34, 30, 29 and 28.
- Once per account: through a relaunch, later revocation, duplicate mounts,
  refreshes and foreground changes. Employees and tenants are kept apart, and
  re-eligibility through either level shows it again.
- Closes unanswered on sign-out or an employer change while open. A background
  launch waits for the foreground.
- The iOS presentation guard frees the flow. Light and dark palettes are
  checked, along with headers and one screen-reader stop per row.
- Development preview: both modes open whatever the configuration. Nothing is
  requested or recorded. Mode 1 shows no background step, automatic benefit or
  offline row. A preview never replaces a real explanation, a real one replaces
  a preview, and production builds hide the panel.

Slice and hook suites cover the record's lifetime and the screen's button. A
mutation check (removing the once-per-account gate, the presentation guard, the
close-on-change, the re-eligibility reset or the iOS single button) fails the
suite each time.

## Device verification checklist

Verified on the iOS 26.5 simulator (iPhone 17, dev build), through a temporary
preview with no permission requests: dark and light palettes, the default text
size (fits without scrolling), and Accessibility Large (scrolls, Continue stays
pinned). Still to check on devices, with a disposable staging employee
(tenant `geo_tagging: true`, employee `geotagging: 2`):

- [ ] iOS fresh install: the explanation appears after sign-in. Continue → "Allow While Using App" → "Change to Always Allow" → the explanation closes and monitoring becomes Active.
- [ ] iOS: "Don't Allow" at the first prompt → the explanation closes, no further prompt, and the screen shows "Location permission required".
- [ ] iOS: open a screen's sheet just as settings refresh → the explanation does not appear and nothing hangs; the next foreground shows it.
- [ ] Android 14: Continue → "Precise" + "While using the app" → the settings page → "Allow all the time" → back in the app, the explanation closes and monitoring is Active.
- [ ] Android 14: Not now, and the hardware Back button → no prompt; relaunch → not shown again.
- [ ] Android 10 and Android 9 devices (or emulators): the background step and its copy.
- [ ] Both: sign out and in as another employee, and as the same ID on another tenant → shown again for each.
- [ ] Both: set the employee to 0, then back to 2 → shown again. Revoke access in Settings → not shown automatically; the screen's button explains and asks.
- [ ] Both: TalkBack/VoiceOver reading order, RTL (Arabic system language), largest text sizes, and a small phone (iPhone SE / 5" Android).
- [ ] FCM's notification prompt at sign-in and the explanation never overlap as two system dialogs.

The iOS purpose strings in `Info.plist` / `app.json` mention "real-time location
updates for drivers during trips". That is not what automatic attendance does,
and the system prompt shows that text directly under this explanation.
Correcting it needs a native build.

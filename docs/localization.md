# English, Arabic, and RTL implementation report

Implementation and verification date: 29 October 2026. This report describes the checked-out changes, not a production sign-off.

## Architecture

- The inspected application uses Expo 57.0.27, React Native 0.86.3, React 19.2.3, React Navigation 7, and predominantly JavaScript/JSX. No framework or unrelated dependency upgrade was made.
- `localization/index.js` owns one offline i18next instance, integrated with react-i18next. Feature catalogues live in `localization/locales/{en,ar}/{common,auth,hr,attendance}.json`. English source phrases are the keys; key and namespace separators are disabled so punctuation remains literal. Catalogues are merged into the default namespace. Duplicate phrases must have identical translations; the validator enforces this.
- `index.d.ts` exposes the catalogue-derived translation-key union and typed public interfaces. The repository has no configured TypeScript application/typecheck command; no unrelated TypeScript conversion was introduced.
- An explicit `settings_language` AsyncStorage preference wins over supported device locales, then English. Regional tags such as `ar-SA`, `ar_EG`, and `en-US` resolve to their supported base language. Unsupported stored values are ignored.
- Language is a device preference outside persisted account Redux, matching appearance settings. It survives logout, token expiry, and tenant changes. No authentication, policy, attendance, or queue key is cleared by a language change.
- Startup awaits locale hydration before rendering the UI. Preference writes finish before publishing a new language; failed writes retain the active UI language and expose a retryable selector error. The selector prevents duplicate in-flight changes.
- Mounted consumers subscribe through `useSyncExternalStore`. `useTranslation()` returns a language-sensitive translation function plus language/direction. Memoized date groups include language in their presentation dependencies; query keys and request effects do not.
- `t()` is for application-owned catalogue keys. `translateMessage()` translates exact known source messages and preserves unknown server text, unless a caller supplies an owned fallback. Tenant-specific descriptions, names, filenames, workflow labels, and server notification text remain backend content.
- Interpolation uses complete phrases. Count-dependent attendance, search, authentication and HR messages include Arabic zero, one, two, few, many, and other forms. Arabic may express zero/one/two grammatically without displaying the count token.

## Direction and typography

The implementation uses supported runtime layout mechanisms, without `I18nManager.forceRTL`, process restarts, or navigation remount keys:

1. `LocaleRoot` sets Yoga `direction` on the application root.
2. `NavigationContainer.direction` and native-stack `contentStyle.direction` use the same selected language. React Navigation passes native-stack direction to the installed native screen/header implementation.
3. Modal content roots explicitly carry the selected direction because native modals create a separate view tree.
4. Shared controls and both screen variants use logical start/end spacing. A final pass converted 39 legacy physical directional classes to native logical styles rather than depending on unsupported NativeWind v2 logical CSS utilities.
5. Directional back/forward chevrons change with app locale. Universal camera, QR, search, clock, company and brand imagery retain their meaning and orientation.

`LocalizedText` uses platform system fonts, which supply Arabic shaping and glyphs. Arabic removes letter spacing, retains font padding, and allows a minimum line height of 1.5 times font size. Font scaling remains enabled. The wrapper converts physical text alignment to React Native's logical left/right alignment. Actual simulator inspection caught and corrected the double-mirroring that would otherwise align Arabic labels to the wrong edge.

`LocalizedTextInput` and `FormField` preserve LTR values for URLs, phone numbers, OTPs, passwords, numeric data and recognized credential fields. Free text follows its script; labels follow the app language. Input direction does not insert characters into stored values. `isolateBidi()` is used only for display interpolation where mixed content requires it. Build stamps retain LTR ordering. Selection, keyboards, copy/paste and screen-reader pronunciation still require physical-device acceptance testing.

An existing native focus-transition defect was found during visual navigation: disabling Welcome's decorative animation produced an invalid null transform in RN 0.86. The paused transform now uses an empty array, with a regression test. The attendance bootstraps and their lifecycle dependencies are unaffected.

## Formatting policy

Formatting is centralized around Intl and the selected app language. The product keeps the Gregorian calendar and Latin digits in both languages (`u-ca-gregory-nu-latn`) to preserve established attendance conventions and readable identifiers. Arabic month/day names and unit copy are localized; English date ordering follows the existing British-style display conventions where applicable.

API date builders, ISO timestamps, wall-clock interpretation, internal duration arithmetic, numeric amounts, document identifiers and SQLite values retain their wire formats. Attendance date/time state stores its source timestamp and formats on display so a language change does not fetch server time again. Fixed elapsed timers remain stable `HH:mm`/`HH:mm:ss` displays; explanatory duration/unit text is localized.

## Coverage and audit checklist

The implementation covers these presentation families and their shared hooks/components:

| Family | Audited screens and variants |
| --- | --- |
| Authentication | Welcome modern/legacy, Login modern/legacy, shared mobile account/password/OTP/recovery/password-creation steps, QR scan modern/legacy |
| Main navigation | Auth and authenticated stacks, modern/legacy tab labels, feature-gated route titles, back buttons |
| Home and profile | Home modern/legacy, quick-access selection modern/legacy, shortcut details and validity displays, Profile, appearance/language/diagnostic settings, Chat and Coming Soon |
| Attendance | Attendance Action modern/legacy, camera, status and break cards, Attendance History modern/legacy, local queue status and recovery sheets |
| Automatic attendance | Modern/legacy status, policy labels, permission explanations, onboarding, diagnostics, event log, location controls |
| HR requests | Attendance Request, Leave Request, Expense Claim, Loan Application, Resignation and Complaints in modern/legacy variants; Salary Advance; shared history, upload and picker components |
| Notifications and overlays | Notification list modern/legacy, details and dates, foreground fallback copy, local checkout notifications, Android channel name, toasts, offline/update banners, error fallback, attachment and option sheets |
| Native resources | English/Arabic iOS permission descriptions, iOS known/localized regions, Android locale metadata and RTL manifest support |

- [x] Initial working tree recorded as clean; original full Jest baseline completed.
- [x] Existing ad hoc mobile copy moved into the shared selected-locale catalogue.
- [x] All current screen files and presentation families included in the source audit.
- [x] Language selector available in Profile and before authentication, including mobile sign-in.
- [x] Catalogue parity, nonempty values, interpolation, duplicate-copy consistency and literal translation references validated.
- [x] Rendered JSX/visible-attribute/alert literals scanned, with explicit invariants for brand names, language autonyms, file formats and the synthetic server-address example.
- [x] Dynamic source maps reviewed: canonical route/shortcut labels, policy labels, backend reason/repayment values, permission copy and notification templates.
- [x] Focused and full behavioral regressions run; native compile and Metro export performed on both platforms.
- [ ] Every authenticated screen visually reviewed on both platforms with a disposable staging account.
- [ ] Physical-device location transitions, killed-process/background behavior, permission prompts and notification delivery verified after the native release build.
- [ ] Professional native-Arabic terminology and accessibility review completed.

The generated [coverage report](localization-coverage.json) records 326 source files, four feature catalogues and 1,449 unique keys per language. It reports zero resource errors, conflicting translations, missing literal keys and detected untranslated source sites. It also lists dynamic translation calls and source maps for review. This is a bounded static check, not a proof that arbitrary backend content or every native layout is localized.

## Attendance and background safety

Localization changes presentation and local notification construction. The session-transition lock, queue migrations, atomic claims, tenant/employee provenance, ordering, deduplication, upload/retry decisions, one-record upload contract and native geofence capture were retained.

The existing tenant/employee eligibility logic is unchanged. Disabled and warnings-only policies do not gain automatic punches; full actions still require tenant and employee eligibility. The existing warnings-only implementation is not expanded into a new monitoring feature by this translation work.

Language changes do not reload the application or replace navigators. Consequently they do not tear down active attendance registrations or clear forms/queued records. New attendance localization tests compare merge outputs, wire values and recovery flags across languages; the existing policy, queue, authentication, permission and background lifecycle suites remain the regression authority.

Local notifications await the persisted locale inside the delivery service, independently of mounted React providers. Titles and fixed bodies translate there; fixed native reliability warnings are translated at the JavaScript display boundary without changing native capture; templated checkout bodies receive source keys and display parameters. Notification permission ordering and payload data remain unchanged. A failed notification still cannot fail attendance processing. Tests exercise Arabic notification construction from a fresh headless module context.

## Native and third-party audit

| Component | Integration and remaining boundary |
| --- | --- |
| React Navigation/native-stack 7 | Selected direction flows to navigation and native content; route names and registration gates remain unchanged. Custom back icons follow locale. |
| React Native/Yoga/Modal | Runtime direction on roots and modal panels; logical margins/padding and directional positioning. No global runtime monkey patch. |
| NativeWind 2 | Legacy styles remain supported. Localization wrappers are included in Tailwind content paths so Babel wraps them correctly. Directional spacing uses native logical properties. |
| DateTimePicker 9.1 | iOS picker receives the selected locale. Android's system picker text follows OS/per-app system locale; its locale prop cannot force a different language. |
| Native picker | App-owned item labels are translated while values remain backend identifiers. Custom option sheets use selected app direction. |
| FlashList/SectionList | Source ordering/pagination remain unchanged; grouping labels refresh by app language. Horizontal scrolling/gesture behavior needs broader physical-device review. |
| Toast/attachment/option sheets | App copy, direction, close labels and accessibility copy localized; modal roots receive explicit direction. |
| System fonts/vector icons | Arabic uses system glyph coverage. Universal icons/QR/logo are not mirrored. No new font/native drawing dependency. |
| Expo notifications/FCM | Local copy and fallback copy localized. Remote push title/body and persisted inbox text are server supplied. |

Permission descriptions in `localization/native/{en,ar}.json` mirror committed `en.lproj`/`ar.lproj/InfoPlist.strings`. iOS declares English and Arabic in Info.plist and Xcode regions. Expo localization config declares supported locales; `withLocalization` retains `android:supportsRtl="true"` in generated manifests. Native OS dialogs use the OS's language resolution, which can differ from the application's custom preference.

## Verification record

Baseline:

```sh
npm test -- --runInBand --watchman=false
```

Result: 138 suites passed; 3,041 tests passed; 13 pre-existing TODOs. Jest reported existing open handles after completion.

Final validation commands:

```sh
npm run validate:localization
npm run lint
npm test -- --runInBand --watchman=false --forceExit
EXPO_NO_DOTENV=1 npx expo export --platform all --output-dir /tmp/claudion-localization-export-final
xcodebuild -workspace ios/ClaudionCheckin.xcworkspace -scheme ClaudionCheckin \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/claudion-localization-build CODE_SIGNING_ALLOWED=NO build
# from generated android/
./gradlew :app:assembleDebug --console=plain
```

Final result: **147 suites passed, 3,085 tests passed, 13 existing TODOs**. Both platform production Hermes bundles exported successfully. The final unsigned iOS simulator build reported `BUILD SUCCEEDED`; the generated Android debug build reported `BUILD SUCCESSFUL` (640 tasks). Native permission plists/strings passed `plutil -lint`; generated Android manifest declares both RTL support and locale configuration. `git diff --check` is clean. `--forceExit` handles the existing Jest open-handle issue; it does not imply that issue was repaired. Lint completes with no errors and 19 hook dependency warnings, including existing dependencies and intentional locale-driven presentation recomputation. No TypeScript application check is configured in this JavaScript repository.

## Platform review scope

Clean simulator/emulator accounts were used, with no credentials or staging backend calls. English/Arabic Welcome and Arabic mobile account layout were inspected. Real Android taps exercised the language selector. iOS exercised the same persisted API through the local development debugger and verified Arabic after relaunch on English device settings. This is supplemental UI verification, not live authentication or attendance compatibility evidence.

Screenshots in [localization/screenshots](localization/screenshots/) capture selected verified layouts. An unsigned iOS simulator build emitted an Expo notification keychain entitlement warning; developer overlays were dismissed for layout capture. Signed push registration and delivery remain unverified. Additional observed scenarios:

| Scenario | Observed result |
| --- | --- |
| iPhone 17e / iOS 26.5, English native preference + Arabic app | Arabic Welcome and mobile form showed RTL rows, correct back arrows, shaping and readable labels. |
| iOS restart with saved Arabic | Arabic preference retained on English native locale. |
| iOS live Arabic → English on mobile form | Direction became LTR; current `MOBILE` route was retained. |
| iOS Arabic native preference + saved English app | Welcome stayed English and LTR, with native locale supplied through per-app launch arguments. |
| Largest iOS accessibility text size | Arabic heading wrapped without glyph clipping; content extended below the viewport in the existing ScrollView. Full scroll-through/assistive interaction was not verified. |
| Pixel 5 / Android API 36, English → Arabic → English | Real selector taps changed text/direction and restored LTR. |
| Android process restart | Saved Arabic selection retained. |
| Android Arabic mobile form | Native form layout inspected; no sign-in submission or backend call made. |

These are selected simulator observations. Logged-in attendance/HR screens, dark-theme visual coverage, full accessibility traversal and real geofence events still need the release review above.

## Release and outstanding dependencies

A **new native build is required** for ExpoLocalization and localized native resources. The shared runtime is now `1.2.1-sdk57-localization-v3`; app.json and committed iOS Expo.plist match. iOS build number is 15 and Android versionCode is 23. App marketing version remains 1.2.1. Do not send this native capability to older attendance runtimes through an OTA-only release. The guarded device-locale read still lets older binaries fall back safely, but does not add native locale support to them.

No commit, OTA update, remote build, deployment or publication was performed.

Before production sign-off:

- Have a native Arabic reviewer inspect wording, attendance/recovery distinctions, gender-neutral instructions, long labels and screen-reader pronunciation.
- Use a disposable staging tenant to verify both sign-in methods, OTP-only and recovery flows, employee mapping, refresh tokens and complete attendance policy. Existing mobile-auth rollout blockers are not resolved by mocked tests or native compilation.
- Run authenticated-screen visual review in both themes, smaller screens and large text; test keyboards, cursor/selection, copy/paste, accessibility order, native gestures and pickers on physical iOS/Android devices.
- Exercise actual office entry/exit, warnings-only eligibility, permissions, force-close/relaunch, foreground/background/offline synchronization and retained queue records while changing language.
- Supply translated remote push/inbox content and tenant-defined display text from the backend. No backend locale contract or server translation endpoint was invented. Unknown server prose may remain English.
- Native system permission dialogs, Android system picker text and keyboards follow OS/per-app system language; resource availability is implemented, but these cannot be assumed to follow an independent in-app selection.

## Technical references

Implementation was checked against the installed dependencies and these official references:

- [Expo localization and RTL guidance](https://docs.expo.dev/guides/localization/)
- [React Native I18nManager](https://reactnative.dev/docs/i18nmanager)
- [React Navigation direction](https://reactnavigation.org/docs/navigation-container/#direction)
- [i18next translation framework](https://www.i18next.com/)


## Compact authentication footer

The shared `AuthFooter` replaces the dated manual build stamp on authentication
screens. A 38pt secondary language pill sits above separate, muted app/OTA
metadata, with a 44pt iOS or 48dp Android touch target. The default Profile
language setting retains its existing layout. The pill uses theme surface/border
tokens, medium 15pt text, a globe, and the alternative language name.

`describeAuthFooter` reads the available native/config app version (falling back
to the bundled app config) and the running Expo update identity. Applied OTA
bundles show an eight-character update ID; embedded and development bundles are
labeled honestly. The footer performs no update check, API call, or restart.
Platform metadata is captured once per launch; its labels remain reactive to
language changes. No new dependency or native build is required for this UI change.


The compact footer was visually checked on the smaller iPhone simulator in both
dark English and dark Arabic. Its version line remains inside the safe-area
viewport after reducing only the empty gap above the mobile footer. Previews:
[English](localization/screenshots/login-footer-en-dark.png) and
[Arabic](localization/screenshots/login-footer-ar-dark.png). The platform-specific
44pt/48dp touch sizes, switching, persistence failures and rapid taps are covered
by the component tests.

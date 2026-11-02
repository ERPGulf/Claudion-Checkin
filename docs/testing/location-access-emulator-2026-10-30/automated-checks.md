# Automated checks

Recorded on 2026-10-30. These results describe the linked automated evidence. Native harnesses and mocked Jest tests do not establish simulator, physical-device, or staging-backend behavior.

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Full Jest suite | PASS: 150 suites, 3,163 tests passed; 13 TODO | [jest-final.log](automated/jest-final.log). Serial run with `--watchman=false --silent --forceExit`. Jest reported remaining asynchronous handles; forced exit is not an open-handle fix. |
| Focused processor suite | PASS: 97 tests | [focused-final.log](automated/focused-final.log). Includes genuine ENTER after outside recovery and replay after restart. |
| Android release build and vital release lint | PASS | [android-release-final.log](automated/android-release-final.log), `assembleRelease lintVitalRelease -PreactNativeArchitectures=arm64-v8a`; 1,077 tasks, 1m 7s. Other ABIs were not rebuilt. |
| iOS final application build | PASS | [ios-final-build.log](automated/ios-final-build.log), unsigned Debug ARM64 simulator build; rebuilt after Xcode marketing-version alignment. |
| Release field alignment / plists | PASS | [release-field-alignment.json](automated/release-field-alignment.json), runtime, build numbers, and marketing version agree; all native plists/project pass `plutil -lint`. |
| ESLint | PASS: 0 errors, 19 warnings | [eslint-final.log](automated/eslint-final.log). Existing hook dependency warnings remain, including one unnecessary `baseUrl` dependency in `useAutoAttendance`. |
| Android native journal harness | PASS: 25 cases | [android-native-final.log](automated/android-native-final.log). JVM persistence/policy/geometry checks; this harness does not execute Android OS location callbacks. Includes verified-outside recovery followed by a genuine ENTER. |
| iOS native Foundation harness | PASS: 99 checks | [native-foundation-tests.log](ios/native-foundation-tests.log). Freshly compiled and executed after reviewing the cached-fix repair. Exercises actual durable store, recovery geometry, and attempt gate; excludes Core Location delegate delivery and timers. |
| Local mock backend contract tests | PASS: 7 tests | [backend.log](automated/backend.log). Real loopback HTTP server with isolated temporary records. Tests authentication envelopes, scope refusal, exact timestamp preservation, duplicate handling, offline response shape, redaction, persistence, and ambiguous/rejected acceptance. This is not live backend verification. |
| Localization validator | PASS | [localization-final.log](automated/localization-final.log). 327 files, 1,458 EN keys and 1,458 AR keys; 0 resource errors, translation conflicts, missing literal keys, or unlocalized source sites. 57 dynamic translation calls require separate runtime/UI coverage. |
| TypeScript checks | NOT CONFIGURED | `package.json` contains no typecheck script, and no repository `tsconfig` is configured. The installed TypeScript dependency is not a typecheck result. |

The iOS regression added in this test run holds the same attempt open across a cached fix and an uncertain fix, verifies no receipt is added and original loss provenance is retained, then accepts a fresh inside fix using the original request time. Concurrent attempts and repeated accepted-fix delivery remain non-authorizing. The actual Core Location stream repair is validated separately by simulator execution.

Native application builds and installations are tracked with the platform evidence. An earlier successful build is not evidence that a later native change was compiled; rebuild and device retest results must accompany the final report.

The host-only QA scripts remain outside the production app bundle. Provisioning, actions, and snapshots refuse non-local tenants. The backend accepts only disposable QA employee identities, redacts password/token fields, and exposes no attendance insertion/reset control. The iOS filesystem collector is read-only and must be pointed only at the newly created disposable QA simulator; its `QA_IOS_UDID` override must name a `Claudion Location Access QA` device; this name guard does not independently establish tenant ownership.

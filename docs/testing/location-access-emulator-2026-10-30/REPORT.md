# Location-access checkout integration report — 2026-10-30

The actual native Android and iOS apps were built, installed, authenticated, and exercised against an isolated local HTTP backend. Both platforms captured OS-confirmed loss, closed the matching AUTO session once, recovered outside without a punch, and accepted a later genuine office entry. Both retained a queued cutoff across restart and uploaded its original timestamp once. Two defects discovered during execution were fixed, rebuilt, and retested.

This is **local integration validation**, with the remaining physical-device and live-backend checks below. No staging credentials were available; no production tenant or employee was used. Nothing was committed, deployed, submitted, or published. Existing databases were retained throughout fixes and restarts.

## Environment and execution boundaries

| Item | Actual setup |
| --- | --- |
| Application | Expo 57.0.27, React Native 0.86.3; compiled local module, not Expo Go |
| Release fields | Stale Xcode marketing settings were aligned from 1.0 to 1.2.1 and rebuilt. Version 1.2.1; runtime `1.2.1-sdk57-location-cutoff-v1`; Android code 24; iOS build 16. App configuration, committed iOS plists, and both Xcode configurations agree. |
| Android | New disposable Google Play ARM64 Android 15/API 35 AVD, serial `emulator-5560`, target SDK 36; native Debug app installed with `adb install -r -t` |
| iOS | Xcode 27.0; new disposable iPhone 17 Pro/iOS 26.5 simulator `FC19E559-3811-4ACF-B5E9-0933E113C411`; unsigned ARM64 Debug app installed with `simctl install` |
| iOS 27 fallback | The separately created iOS 27 simulator reported Core Location circular region monitoring unavailable. Authorization reads/callbacks were exercised there; actual geofence integration moved to iOS 26.5, which reported the capability available. See [capability evidence](ios/ios27-corelocation-capability.json) and [iOS 26 evidence](ios/ios26-corelocation-capability.json). |
| Backend | Host loopback server on port 8765; Android tenant `http://10.0.2.2:8765`, iOS tenant `http://localhost:8765`; separate synthetic employees `QA-ANDROID-001` / `QA-IOS-001` |
| Office | Latitude 25.2854, longitude 51.5310, radius 100 m; outside 25.29, 51.54 |
| Authentication | QR provisioning fields in fresh disposable sandboxes, followed by actual password Login UI and the normal token exchange. No attendance session or server attendance record was seeded. |
| Observation | Real OS coordinates/privacy controls, native persisted journals, actual SQLite ingress/queue queries, real session authority, network requests, stored local backend records, screenshots, and native logs |
| Automation | ADB, `simctl`, Maestro UI actions, and host-only Hermes inspector scripts. Scripts never inject attendance receipts or replace attendance authorization; position watches request real OS positions. |

The fresh Android image initially had no fused fix; Maps and then a real Expo Location watch initialized the provider. One host emulator exit required restarting the same AVD without wiping data. Detailed platform logs, commands, event IDs, and screenshots are indexed in [Android scenarios](android/scenarios.md) and [iOS scenarios](ios/scenarios.md).

## Defects found and fixed

| Defect | Reproduction | Targeted change | Retest |
| --- | --- | --- | --- |
| Android suppressed a genuine ENTER after verified outside recovery | Original ENTER seq5 `4385fbbf-d17b-44ed-9578-a42b9395561d` stayed OUT with reason `access-recovery-enter-evidence`. The recovery barrier outlived outside proof; an earlier EXIT belonged to a retired physical registration. | Outside proof stops tagging subsequent genuine ENTER. A durable marker still disables registration-repair initial ENTER triggers. Inside recovery retains its ENTER barrier until a valid EXIT. | **PASS** after data-preserving upgrade: loss seq10, outside recovery seq11, genuine ENTER seq13 `eb1f36e5-d461-4235-b430-e43c1438268d` creates one IN; normal EXIT seq14 creates OUT. [Snapshot](android/11-fixed-return-inside.json), [normal exit](android/12-normal-exit.json); new native and JS regressions passed. |
| iOS recovery repeatedly rejected an immediate cached fix and cancelled before a fresh sample | `requestLocation()` returned a pre-request fix; repeated attempts remained pending despite new simulated positions. | One dedicated manager streams positions for the same bounded attempt, ignores cached/invalid/uncertain fixes, and stops on decisive fresh proof, failure, cancellation, or the 15 s deadline. Existing token/deadline/access/journal guards remain. | **PASS** after rebuild/upgrade: fresh outside recovery seq4 `BA99F5D5-80CD-4CFC-8BEC-2F2D59B057C5`; genuine ENTER seq5 `709FE3B6-3EAA-4EC1-9A34-9E5F1DC2F3FE` creates one IN. Later matched inside recovery also creates one IN. [Snapshot](ios/fixed-outside-then-inside.json), [native stream regression](ios/native-foundation-tests.log). |

Original failure evidence is retained. Fixed native source was compiled into the installed apps; final builds also passed. Earlier stale physical-registration callbacks remain quarantined in SQLite with `native-capture-issue` / `stale-registration` and did not authorize punches. They were not deleted to force a clean result.

## Actual device integration results

The status below applies to the specified execution method. A deterministic regression does not turn an unexecuted OS scenario into an emulator PASS.

| Case | Platform / method | Expected and observed result | Status / evidence |
| --- | --- | --- | --- |
| Normal ENTER → AUTO IN | Both, real OS simulated movement | Native receipt → SQLite → exactly one accepted IN, active AUTO session, generation retained | **PASS**. Android initial event `81781699-a2cc-4ded-8809-d49e2094bc4b`, record `QA-CHECKIN-00001`; iOS `F591500D-4605-4383-BE45-7AAE7891F147`, record `QA-CHECKIN-00003`. Platform reports contain full snapshots. |
| Confirmed loss → one cutoff | Android global services switch; iOS actual privacy revocation | One typed LOSS without a manufactured EXIT; exact loss time closes eligible AUTO session | **PASS**. Android initial loss `31c57905-774f-4dfc-9c85-3e5ff79b1c47`, T=1793355474151; iOS `38C17DE2-E318-4E08-B6CF-9F3DFCACDEBC`, T=1793355556993. |
| Leave while denied; restore outside | Both, real OS access and coordinates | Fresh accuracy-aware outside recovery creates no IN or extra OUT | **PASS**, original and fixed runs. Android [fixed loss](android/10-fixed-loss.json), [outside/return evidence](android/11-fixed-return-inside.json); iOS fixed snapshot above. |
| Return inside; normal exit | Both, real geofence ENTER/EXIT | New session only after genuine entry; normal exit closes it | **PASS** after fixes; platform reports include sequence and stored punch evidence. |
| Precise → approximate with process restart | Android, actual `pm revoke ACCESS_FINE_LOCATION`, coarse/background retained | New process observes explicit precision revocation, retains logical generation, one cutoff at observed time | **PASS**. PID changed from 1651 to 3649; loss seq16 `47ee9eb4-61ad-4cf0-a736-c58b05b8e1ca`, T=1793374990864. [Snapshot](android/14-approximate-restarted.json), [OS permission state](android/14-approximate-permissions.txt). |
| Restore precise; verify inside | Android actual permission grant and fresh OS fix | One replacement IN linked to original loss | **PASS**, recovery seq17 `e6c75c37-cef1-4bdd-8258-d086e8778e15`. [Snapshot](android/15-precise-restored-inside.json). |
| Background permission revoked | Android Home + actual background permission revoke | One confirmed background-loss receipt/cutoff, stale callbacks cannot check in | **PASS**, loss seq20 `fda49e86-ce94-457b-bb7e-af50f0764837`. [Snapshot](android/21-background-revoked.json). |
| Force-stop before services disabled; relaunch | Android real force-stop and services switch | No invented loss time while stopped; first launch observation becomes T; generation retained | **PASS**. Persisted [pre-observation state](android/27-force-stopped-before-observation.xml), [prelaunch device clock](android/27-before-relaunch-device-ms.txt), loss seq23 `936bf97d-63a3-4c60-b730-458c5f65fef3`, T=1793375381197 in [snapshot](android/27-first-observation-after-force-stop.json). |
| Repeat denial and restart during interruption | iOS actual terminate/relaunch + privacy denial | Same loss ID/time/generation, no second OUT | **PASS**, loss seq8 `6EDC9003-4596-4645-9DCA-C894B4C1DB9E`, T=1793374977479; detailed evidence in iOS report. |
| Precise Location OFF/ON | iOS actual Settings switch, Always authorization retained | Precision is independent of measured accuracy; first observable reduced authorization causes one cutoff; restored precise needs fresh inside proof | **PASS**. Loss seq10 `3F2F89EE-C6AE-4953-B279-B108F86DFC6C`, T=1793375386157; recovery seq11 `87F5F606-191F-4FAE-85BB-5E667A928AFB` creates one IN. Background change was first observed on foreground; no backdated timestamp. |
| Network failure alone; battery saver | Android backend socket drop + actual OS saver (`low_power=1`); iOS backend socket drop | Existing AUTO session remains active, no new LOSS/queue row | **PASS**, Android [snapshot](android/16-network-drop-battery-saver.json); iOS report. Socket drop tests transport unavailability, not radio shutdown. |
| ±200 m GPS while checked in | Android OS test provider, real app position watch, accuracy=200 m at office center | No access LOSS, no checkout/new queue row; active AUTO retained | **PASS**, [actual fix](android/26-weak-gps-fix.json), [session/SQLite](android/26-weak-gps-active.json), [EN notice](android/26-weak-gps-active-en.png), [AR notice](android/26-weak-gps-active-ar.png). Controlled accuracy is not physical indoor reception. |
| Uncertain recovery | Android OS test provider accuracy 200 m, successful OS access reads | No recovery receipt/punch, original episode stays pending | **PASS**, [available/pending access](android/23-uncertain-access.json), [journal/SQLite](android/23-uncertain-recovery.json). |
| Concurrent/no-fix requests; later retry | Android real native recovery API, no new provider fix | Second caller cannot start another request; timeout frees slot without IN/OUT; later fresh inside fix creates one IN | **PASS**, first request 15008 ms / second caller 4 ms in [concurrency evidence](android/23-no-fix-timeout-concurrent.json); next timeout 15006 ms in [retry](android/24-no-fix-timeout.json); recovery seq22 in [fresh result](android/25-fresh-after-timeouts.json). No deterministic late OS callback was injected. |
| Active session with no fixes | iOS actual simulator location cleared for 90.882 s | Active AUTO session retained; event count stayed 11, queue count stayed 1 (the already-synced historical OUT) | **PASS**, [start](ios/no-fix-active-start.json), [end](ios/no-fix-active-end.json), [OS access available](ios/no-fix-active-os-state.json). Does not reproduce physical indoor RF reception. |
| iOS missing/cached positions | Actual simulator location cleared; access restored | Recovery remains pending without new punches; later fresh inside update succeeds | **PASS** for safe pending/retry/inside. Some no-fix requests failed immediately or encountered an existing request; those runs do **not** prove a measured iOS 15 s timeout. |
| Offline cutoff across restart/upload | Both, backend transport fault + real app termination/relaunch + normal synchronization | One durable row, original timestamp unchanged, one stored OUT after delay | **PASS** against local mock only; comparisons below. |
| EN/AR messages and RTL | Actual Android weak-GPS and recovery screens; iOS recovery screen | Active-session reassurance differs from pending recovery; Arabic renders RTL | **PASS** for captured states. iOS modern dark EN/AR and legacy light EN/AR were also captured. Shared component regressions cover both screen variants and theme contexts; all combinations were not visually driven on both devices. Legacy uses its existing light design. |

Additional actual Android integration cases:

| Case / method | Observed result | Status / evidence |
| --- | --- | --- |
| Complete foreground permission revoke and process relaunch | One loss `31d33e74-0c49-44f7-b78f-4708e4cf18a5` at 1793375501055 and OUT; restoring permissions and fresh inside proof gives one IN | **PASS**, [loss](android/31-foreground-complete-loss.json), [recovery](android/32-foreground-restored.json). Coarse-only removal while fine remained available preserved the session. |
| Employee modes 0/1 and tenant geo=false, ordinary server refresh | No native fence or automatic punch; mode1 service toggle adds no loss. Restoring eligible mode2 creates a fresh generation | **PASS**, [mode0](android/34-policy-mode-zero.json), [mode1](android/35-policy-mode-one.json), [tenant disabled](android/37-tenant-geo-disabled.json), [restored](android/38-policy-mode-two-restored.json). |
| MANUAL session during confirmed loss/recovery | Loss32 is non-authorizing; MANUAL session remains active with no AUTO punch | **PASS**, [loss](android/42-manual-origin-access-loss.json), [recovery](android/43-manual-origin-recovery.json). Uses the same guarded manual service as the UI, with real GPS/HTTP; no session seeding. |
| Manual IN/OUT between AUTO cutoff and fresh inside recovery | Recovery37 rejected with `access-recovery-session-mismatch`; no replacement IN | **PASS**, [pending episode](android/47-manual-intervention-pending.json), [rejected recovery](android/55-manual-activity-recovery-rejected.json). |
| Actual Wi-Fi/mobile data disabled | Direct ADB journal/SQLite read shows no new loss or queue row; active AUTO remains after restoration. Inspector was unavailable while offline | **PASS**, [radio state](android/58-wifi-disabled.txt), [SQLite while offline](android/58-os-network-disabled/sqlite.json), [restored](android/59-os-network-restored.json). |
| Assigned geometry changed and restored through backend refresh | Each genuine configuration replacement changes generation | **PASS for registration replacement**, [changed](android/56-assigned-geometry-replaced.json), [final](android/61-final-preserved-state.json). Stale recovery for this particular live change was not injected; deterministic stale-generation tests passed. |
| Accepted OUT followed by socket disconnect | Two identical HTTP POSTs; one stored mock OUT | **PASS for mock record uniqueness; exactly-once transport NOT ESTABLISHED**, [request evidence](android/33-ambiguous-request-evidence.json). Requires real-backend idempotency verification. |

The [Android scenario report](android/scenarios.md) records the remaining methods and limitations. The corresponding deterministic isolation/manual/queue contracts also passed in the full Jest run.

## Delayed timestamp evidence

| Platform | Original queued OUT | Stored local record | Submission delay / result |
| --- | --- | --- | --- |
| Android | Event `1eff8e1a-2bff-4ff6-b1db-8851174fe109`, SQLite row1, `2026-10-30 15:44:10` | `QA-CHECKIN-00016`, `time` and `timestamp` both exactly original; offline endpoint | Received `2026-10-30T15:44:46.870+00:00`; one matching OUT. [Original](android/17-offline-cutoff.json), [restart](android/18-offline-restart.json), [synced](android/19-offline-synchronized.json), [record comparison](android/19-delayed-timestamp-comparison.json). |
| iOS | Event `3F2F89EE-C6AE-4953-B279-B108F86DFC6C`, SQLite row1, `2026-10-30 15:49:45` | `QA-CHECKIN-00023`, both stored timestamp fields unchanged; offline endpoint | Received `15:51:05.859`, about 80 s later; one matching OUT. [Exact record comparison](ios/delayed-timestamp-check.json). |

These records were created only by real app attendance POSTs. The mock intentionally preserves supplied timestamps. **Live Frappe/staging persistence remains BLOCKED by absent authorized credentials.** Before rollout, submit a delayed cutoff on a disposable staging employee, read the raw Employee Checkin OUT record, and compare it with the frozen queue timestamp. If the endpoint substitutes receipt time, a backend change is required; that backend is outside this repository.

## Automated/native/build results after fixes

| Check | Result |
| --- | --- |
| Focused attendance processor Jest | **PASS 97/97**, including outside recovery followed by one genuine ENTER and replay after restart |
| Full Jest | **PASS 150 suites / 3163 tests**, 13 existing TODO; serial `--watchman=false --silent --forceExit` |
| Android production journal/store/policy JVM harness | **PASS 25 cases** |
| iOS production store/geometry/attempt-gate Foundation harness | **PASS 99 checks**, including cached→uncertain→fresh observations in one attempt |
| Local backend HTTP contracts | **PASS 7 tests**, including ambiguity, scope, deduplication, exact stored timestamps, and redaction |
| Android final release and vital release lint | **PASS**, `assembleRelease lintVitalRelease -PreactNativeArchitectures=arm64-v8a`, 1077 tasks, 1m 7s; production Metro bundle included |
| iOS final native app build | **PASS**, unsigned Debug ARM64 simulator build using iOS 27 SDK; installed fixed binary executed on iOS 26.5 |
| ESLint | **PASS 0 errors**, 19 existing hook-dependency warnings |
| Localization | **PASS 1458 EN / 1458 AR keys**, 0 errors/conflicts/missing literals/unlocalized sites; dynamic keys require runtime checks |
| TypeScript | **NOT CONFIGURED**: no typecheck script or repository tsconfig; installed dependency does not establish a check |

Commands, logs, warnings, and harness boundaries are in [automated checks](automated-checks.md). Jest's existing asynchronous-handle warning remains; `--forceExit` is not a fix. Android Gradle deprecation and iOS run-script warnings remain. Unsigned simulator notification keychain warnings did not prevent attendance integration; production push entitlements were not validated here.

Deterministic tests cover inside-boundary equality, outside-boundary equality remaining uncertain, zero/negative/missing/nonfinite accuracy, invalid coordinates, stale/pre-request/future fixes, unknown access reads, generic geofence errors, timeouts/late callbacks, repeated observations/restarts, SQLite migrations, claims, pairing, offline refusal and ambiguous acceptance, manual/unknown sessions, tenant/employee/generation changes, eligibility, and old-binary bridge compatibility. These are **automated/native harness PASS**, not claims of corresponding OS fault injection.

## Remaining release checks

| Case | Status and required work |
| --- | --- |
| Real indoor weak reception / OEM battery restrictions | **NOT TESTED on physical devices**. Android controlled accuracy and deterministic safety tests passed. Test representative physical Android/iPhone devices indoors. |
| Real background suspension, terminated-app geofence wake, reboot/power policies | **NOT TESTED on physical devices**. Simulator foreground/background/relaunch evidence cannot prove actual wake reliability. Android force-stop suppresses execution; only first subsequent observable loss can be timestamped. |
| Entirely unobserved disable→enable cycle | **Mobile-only enforcement limitation**. The client cannot reconstruct OS changes never delivered while stopped, or invent an earlier loss timestamp. |
| Injected OS access-read failures and exact late callback race | **NOT TESTED as OS faults**. Deterministic native/JS guards passed; further instrumentation/physical testing remains. |
| Every restart boundary, account/logout/tenant replacement permutation | **Not exhaustively executed on devices**. Scoped replay, migrations, claims, manual/unknown activity, and replacement tests pass deterministic contracts; platform reports enumerate actual cases. |
| Real server timestamp/idempotency, live auth mapping/refresh, tenant capability | **BLOCKED: no staging credentials**. Use a disposable authorized tenant/employee; no production data was touched. |
| Signed iOS device/archive and Android other ABI packaging | **NOT TESTED in this run**. Native simulator build and ARM64 Android release passed. |
| Physical Arabic layout/theme/screen combinations | **NOT exhaustively visually tested**. Captured states and component/localization regressions passed. |

Backend duplicate handling also needs staging verification. A deliberate disconnect after the Android backend accepted an OUT produced two identical HTTP POSTs 6 ms apart; the mock stored one record by atomic deduplication. This is **not** evidence of exactly-once HTTP dispatch. See [request evidence](android/33-ambiguous-request-evidence.json). The client source-event journal/claims cannot by themselves prevent a lower transport layer from replaying an HTTP request. Require atomic server idempotency for the employee, action, and original timestamp (or a coordinated idempotency-key contract) on online and offline attendance endpoints. If that is absent, a backend correction is a release prerequisite. Global authentication/network transport contracts were preserved. React Native's installed `OkHttpClientProvider` uses the default OkHttp builder; [upstream OkHttp 4.9.2 documentation](https://github.com/square/okhttp/blob/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/OkHttpClient.kt#L555-L575) describes automatic connection-failure recovery. A native replay is consistent with the observation, but this code inspection alone does not trace that specific request.

The QA devices and local backend use disposable state. Platform reports record restoration of access, simulated position/provider overrides, radios/power settings, language, and local failure controls. Attendance records and journals are retained for review; no production database was cleared. Only the new disposable devices were shut down, and the task-owned Metro/local backend services were stopped after exports; see [restoration evidence](restoration.json). The [final backend summary](local-backend-final-summary.json) records 28 Android and 10 iOS stored punches with no duplicate stored employee/timestamp/action keys. Host-only QA tools are documented in [the driver README](../../../test-utils/locationAccessQa/README.md).

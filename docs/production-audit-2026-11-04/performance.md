# Performance and resource evidence

## Controlled before/after behavior

| Scenario | Baseline evidence | Remediated behavior |
| --- | --- | --- |
| Release startup with unresolved OTA server request | New `appStartup` regression failed: useful screen never mounted within the 1-second assertion window after local resources resolved. `App.js` awaited check, download and automatic reload before `appReady`. | Same test passes with update promise unresolved; startup makes **zero OTA requests**. This removes a network dependency, not a measured device startup duration. |
| Repeated active events during update check | Controlled banner regression observed **3 checks** for mount plus two active events while first was pending. | **1 check**, **1 download** for the available result. |
| Background attendance launch | Banner previously checked on mount regardless of AppState; App separately waited on updates before mounting attendance. | Banner performs **0 checks/downloads** until foreground; attendance hydration is not gated by JS OTA work. Native Expo launch-update behavior remains configured. |
| Failed update download | Effect depended on `isDownloading`; completion/failure could immediately trigger another fetch while update remained available. | One attempt per check cycle; state toggles do not retry. A later foreground event is the recovery opportunity. |
| Obsolete permission flow | Four pre-fix cases still requested background permission after tenant/employee/session changes. | Zero subsequent background prompts for five cancellation cases, including unmount. |
| Connectivity race | Older fetch/native callback overwrote later observation or changed cache after teardown. | All six new lifecycle cases preserve current transport observations. Unknown connectivity remains attemptable, independent of Internet-probe status. |

No percentage startup improvement, frame rate, reduced battery use or measured leak elimination is claimed from those deterministic counts.

## Bundle baseline

Command: `EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 CI=1 npx expo export --platform all --output-dir /private/tmp/claudion-audit-baseline-export`. Real Hermes bytecode exports succeeded with local public-environment files excluded. Baseline Android: **7,591,035 bytes**, iOS: **7,572,952 bytes**. Final measurements are recorded in the validation report. Export time is affected by Metro caches and concurrent native compilation and is not an application startup benchmark.

| Hermes bytecode | Before | After | Change |
| --- | ---: | ---: | ---: |
| Android | 7,591,035 B | 7,601,798 B | +10,763 B (+0.14%) |
| iOS | 7,572,952 B | 7,583,508 B | +10,556 B (+0.14%) |

The added ownership/lifecycle checks slightly increase bundle size. This audit does not claim a bundle-size reduction.

## Rendering, memory and storage assessment

Reviewed startup/provider composition, stable navigation component ownership, shared hooks, list pagination/search, theme/localization subscriptions, native-driver loading/Welcome loops and reduced-motion tests. Retained Welcome loops already stop on blur/background; shared skeletons already stop under reduced motion. No profiler evidence justified adding memo wrappers or replacing the existing animation system.

The test runner's retained QueryClient cancellation test created a detached query whose fetch-finally rearmed a 300,000-ms GC timeout after cache clearing. Two other UI/history suites retained 42 five-minute GC timers from undisposed test clients. Timer allocation tracing identified both causes; cleanup now disposes detached queries, observers and test clients. This is test resource hygiene; no production Query-core behavior was changed.

Unacknowledged native/SQLite records must be retained. Their serialized journal growth, photos/cache retention, large HR response sizes and native retry wake frequency remain measurable workload risks. No arbitrary record cap, TTL purge, continuous GPS polling, added retry timer or cache eviction was introduced.

Before release, profile cold/warm/resumed launches and first useful screen in release builds on the slowest supported Android and an iPhone; use RN DevTools/native traces for render/heap allocation and Instruments/Android power tools for a shift with real crossings, offline periods and recovery. Capture baseline/final under identical device/network/data conditions. Simulator/component tests cannot supply those results.

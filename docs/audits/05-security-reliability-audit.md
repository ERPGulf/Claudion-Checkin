# Security, attendance durability and reliability

Date: 2026-10-28. No real account credentials, employee payloads or production data were read for this audit. API/security regressions use synthetic tenants/credentials and mocked transport; SQLite tests use the isolated fixture. Earlier separately authorized live tests are historical evidence, not rerun here.

## Confirmed security findings

| ID / severity | Root cause / evidence | Fix and regression |
| --- | --- | --- |
| F01 High | Process-global QueryClient with employee-only keys survived tenant/account changes; identical codes could reveal previous HR history while replacement fetch failed/pended | [queryClient.js:9](../../services/queryClient.js#L9) and [authSessionGuard.js:8](../../utils/authSessionGuard.js#L8) synchronously clear query/mutation cache and cancel retryers. queryClientSession exercises same-code switches, old in-flight completion, abort/retry cancellation, listeners and token-rotation stability |
| F02 High | Ordinary apiClient absolute URLs always received the current bearer, including foreign hosts; request generation could change across storage reads/retry | [apiClient.js:513](../../services/api/apiClient.js#L513) checks Axios' effective destination including baseURL/allowAbsoluteUrls, tenant path/custom port and protocol-relative URLs. Foreign ordinary requests remain possible without session bearer or session refresh; scoped attendance rejects a foreign effective destination. Generation is retained/rechecked before transport and authentication retry. apiClient/capabilityTransport regressions verify boundaries while preserving existing capability error contracts |
| F03 High | FCM registration logged the complete device token; other diagnostics emitted token fragments, raw notification/profile/location responses or full upload errors | [fcm.service.js:124](../../services/notifications/fcm.service.js#L124), [employee.service.js:37](../../services/api/employee.service.js#L37), [attendance.service.js:117](../../services/api/attendance.service.js#L117) fully redact tokens and retain boolean/count/status/code metadata. Never dump response bodies, employee GPS/profile data or notification content at modified sites. FCM tests prove callback/POST data is retained while absent from logs; manualLocationTransport proves employee/office/GPS payload omission; refresh log regression rejects token fragments |
| F14 High, open | Current dependency audit identifies affected locked packages; severity and runtime reachability differ | [package.json:43](../../package.json#L43), [package-lock.json:14769](../../package-lock.json#L14769), [package-lock.json:16278](../../package-lock.json#L16278) and inventory below. No blind downgrade, native dependency replacement or unreviewed installation was performed. Controlled compatible patch selection, vendor review and a subsequent full regression/bundle/native compatibility run remain required |

F07 prevents optional native haptics failures from becoming unhandled errors; F09/F10 prevent failed reads masquerading as successful empty UI. F13 repairs [the presence fixture:560](../../__tests__/AutoAttendanceBootstrap.presence.test.jsx#L560), which assigned an undeclared variable instead of the queue-count state it meant to control.

## Dependency evidence and limits

`npm audit --omit=dev --json` was executed against the locked production dependency tree. The initial sandbox attempt failed DNS; the read-only registry query then succeeded with network access. The result reports **37 affected packages: 2 critical, 19 high, 10 moderate, 6 low**. These are package-level advisory classifications, not 37 demonstrated mobile exploits. Full JSON: `/private/tmp/claudion-audit-dependencies.json`.

Critical dependency paths:

- `react-native -> react-devtools-core -> shell-quote@1.8.3`: developer tooling path; no app-owned shell quoting call was found.
- `@react-native-firebase/app -> firebase -> @firebase/database[-compat] -> faye-websocket -> websocket-driver@0.7.4`: transitive JS Firebase database path; app uses native Firebase app/messaging/crashlytics, not a JavaScript database import.

Reachability is a source-level assessment, not proof that a vulnerable path cannot appear in a bundle/toolchain. Do not equate `--omit=dev` with exclusively on-device runtime code. Direct Axios and SDK-transitive Zod advisories also require review. Some npm fix proposals downgrade Expo to 51 or swap native package majors; those conflict with this SDK57/native compatibility baseline and were not executed. The package manifest/lock remain unchanged. Advisory URLs and affected versions are included below; the counts will change as registries publish updates.

## Attendance/authentication invariants reviewed

- All manual/automatic attendance uses the durable transition authority. Its submission lock and queued-vs-server-confirmed distinction remain; no `readSession` call was inserted inside its execute callback.
- Manual punches remain online-only. Automatic admission uses scoped capability/cached employee/location policy. No transport and reachable transport with an unavailable tenant remain different states.
- A failed instance preflight does not create POST dispatch evidence; pending work remains deliverable. A successful GET cannot prove that a later POST committed. Ambiguous sends retain evidence and use read-only exact history verification, never a blind resend.
- Existing SQL migrations, atomic claims/leases, source/timestamp order, deduplication, IN-before-OUT pairing, old manual/photo rows and one-record uploads remain intact. No queue/journal data was deleted, rewritten or capacity-evicted.
- Logout/expiry retain queued attendance. Tenant/employee/auth generation guards are preserved. Query eviction is independent from attendance durability.
- Ordinary 401 refresh sharing/rotation and ordinary 403 pass-through remain. SDK/mobile lookup transport and flow contracts were not changed.
- Native optional-module compatibility is retained; no native method, dependency or production build/runtime field was changed.

## Residual risks and verification gates

Bearer/refresh credentials are stored in app-private AsyncStorage, not a hardware-backed credential API (`apiClient.saveTokens`). This is a confirmed storage design characteristic, not a reproduced sandbox escape. A secure-storage migration needs native availability, first-unlock/background behavior, rollback and no-loss token migration design; it must not be slipped into an OTA-only refactor.

Legacy QR provisioning can retain configured HTTP origins; mobile discovery/typed-address auth requires HTTPS. Do not silently change provisioned tenant schemes. ATS broad loads are disabled in committed iOS configuration; local networking remains allowed. Generated Android cleartext is debug-only. App/iOS runtime/version/OTA fields match. OTA code signing is optional hardening not currently configured; no exploit is asserted and production settings were not changed.

Live staging still must verify SDK employee mapping, token-refresh interoperability, tenant endpoint/permission shapes and recovery. Physical iPhone/Android tests must verify native boundary delivery, locked/background launches, protected storage, process death/reboot, OEM restrictions and true reconnection. Prior Simulator evidence of stale NetInfo after host Wi-Fi reconnect does not establish phone behavior. Full Android store harness needs its absent JSON-java jar; Kotlin journal compilation alone is not a full Android native build.

Remaining lint dependency warnings are review leads, not reproduced stale-closure defects. No claim is made that every service/vendor/native diagnostic or redirect path was exhaustively proven safe.


| Package | Locked versions at flagged nodes | npm severity | Direct dependency | Advisory / dependency source |
| --- | --- | --- | --- | --- |
| @erpgulf/auth-sdk | 0.1.2 | high | Yes | zod |
| @erpgulf/server-lookup | 1.0.0 | high | Yes | zod |
| @expo/cli | 57.0.28 | high | No | @expo/config, @expo/metro-config, @expo/prebuild-config, zod |
| @expo/config | 57.0.10 | low | No | deepmerge |
| @expo/config-plugins | 57.0.10 | moderate | No | xcode |
| @expo/local-build-cache-provider | 57.0.8 | low | No | @expo/config |
| @expo/metro-config | 57.0.13 | low | No | @expo/config |
| @expo/prebuild-config | 57.0.17 | low | No | @expo/config |
| @grpc/grpc-js | 1.9.15 | high | No | [@grpc/grpc-js: A malformed request can cause a server crash](https://github.com/advisories/GHSA-5375-pq7m-f5r2) |
| @isaacs/brace-expansion | 5.0.0 | high | No | [@isaacs/brace-expansion has Uncontrolled Resource Consumption](https://github.com/advisories/GHSA-7h2j-956f-4vf2) |
| @react-native-community/datetimepicker | 9.1.0 | low | Yes | expo |
| @react-navigation/core | 7.13.7 | moderate | No | query-string |
| axios | 1.13.2 | high | Yes | [Axios has a NO_PROXY Hostname Normalization Bypass that Leads to SSRF](https://github.com/advisories/GHSA-3p68-rc4w-qgx5) |
| baseline-browser-mapping | 2.9.14 | moderate | No | [baseline-browser-mapping process termination on invalid input causes denial of service](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| brace-expansion | 1.1.12 | high | No | [brace-expansion: Zero-step sequence causes process hang and memory exhaustion](https://github.com/advisories/GHSA-f886-m6hf-6m8v) |
| browserslist | 4.28.1 | high | No | [Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) |
| decode-uri-component | 0.2.2 | moderate | No | [decode-uri-component: Denial of service via exponential decoding of malformed percent-encoded input](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| deepmerge | 4.3.1 | low | No | [deepmerge mergeObject() allows prototype poisoning of returned objects](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |
| expo | 57.0.27 | high | Yes | @expo/cli, @expo/config, @expo/local-build-cache-provider, @expo/metro-config |
| follow-redirects | 1.15.11 | moderate | No | [follow-redirects leaks Custom Authentication Headers to Cross-Domain Redirect Targets](https://github.com/advisories/GHSA-r4q5-vmmm-2653) |
| form-data | 4.0.5 | high | No | [form-data: CRLF injection in form-data via unescaped multipart field names and filenames](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| js-yaml | 3.14.2, 4.1.1 | high | No | [JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases](https://github.com/advisories/GHSA-h67p-54hq-rp68) |
| lodash | 4.17.21 | high | No | [lodash vulnerable to Code Injection via `_.template` imports key names](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) |
| lodash-es | 4.17.22 | high | No | [lodash vulnerable to Code Injection via `_.template` imports key names](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) |
| minimatch | 10.1.1, 3.1.2 | high | No | [minimatch has a ReDoS via repeated wildcards with non-matching literal in pattern](https://github.com/advisories/GHSA-3ppc-4f35-3m26) |
| node-forge | 1.3.3 | high | No | [Forge has a basicConstraints bypass in its certificate chain verification (RFC 5280 violation)](https://github.com/advisories/GHSA-2328-f5f3-gj25) |
| picomatch | 2.3.1, 4.0.3 | high | No | [Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching](https://github.com/advisories/GHSA-3v7f-55p6-f55p) |
| postcss-selector-parser | 6.1.2 | moderate | No | [postcss-selector-parser allows denial of service through uncontrolled AST recursion](https://github.com/advisories/GHSA-w9m9-85wc-3x92) |
| protobufjs | 7.5.6 | high | No | [protobufjs: Denial of Service via unbounded recursive JSON descriptor expansion](https://github.com/advisories/GHSA-jggg-4jg4-v7c6) |
| query-string | 7.1.3 | moderate | No | decode-uri-component |
| shell-quote | 1.8.3 | critical | No | [shell-quote quote() does not escape newlines in object .op values](https://github.com/advisories/GHSA-w7jw-789q-3m8p) |
| uuid | 7.0.3 | moderate | No | [uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| websocket-driver | 0.7.4 | critical | No | [websocket-driver: Resource limit bypass via message compression](https://github.com/advisories/GHSA-mp7j-qc5w-4988) |
| ws | 7.5.10 | high | No | [ws: Memory exhaustion DoS from tiny fragments and data chunks](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) |
| xcode | 3.0.1 | moderate | No | uuid |
| yaml | 2.8.2 | moderate | No | [yaml is vulnerable to Stack Overflow via deeply nested YAML collections](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) |
| zod | 3.25.76, 4.1.5 | high | No | [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |


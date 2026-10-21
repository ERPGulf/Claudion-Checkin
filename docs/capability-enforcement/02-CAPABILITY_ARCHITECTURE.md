# Capability architecture and failure policy

## One existing authority, strengthened

The implementation extends `utils/featureSettings.js`, the persisted `redux/Slices/FeatureSettingsSlice.js`, the shared hooks and bootstrap. No dependency, capability context, duplicate feature store or persisted feature cache was introduced.

`getFeatureSettings` is the sole wrapper for `employee_app.gauth.employee_checkin_setting`. It accepts the auth context captured by the refresh caller so scope and actual request cannot come from different reads. Boolean wire null now normalizes to false under the confirmed contract; missing/invalid remain normalized unknown null. The service accepts existing response envelopes and Boolean/0/1/string forms. Tenant geo false/null becomes level 0; Boolean true is not interpreted as 2. Version null clears only metadata using a serialized presence marker. Entire unrecognized/malformed success is a failed refresh. Partial merges retain omitted/malformed values, while explicit false/null revokes a previous true and explicit true can reenable it.

The snapshot scope is canonical backend plus employee code. `selectFeatureSettings` checks the active Redux identity and authenticated state before exposing settings to UI consumers. `selectScopedFeatureSettings` checks a caller's persisted scope for non-React execution. `buildSettingsScope` trims legacy URL artifacts and canonicalizes URL authority, preserving path case. The real store always has identity/auth slices; isolated reducer tests can still inspect a standalone slice.

The refresh hook captures authentication generation, gives each refresh a request ID and verifies persisted owner again before accepting the result. Slice reducers reject superseded responses/failures, including an obsolete response after invalidation/logout. QR password re-login can retain provisioning while logout clears UserSlice; a validated refresh restores that same existing identity into UserSlice before consumers read the settings. This is identity hydration, not a new feature store or a change to authentication.

## Snapshot health

The existing fetch statuses remain compatible (`idle`, `loading`, `success`, `error`). `featureSettingsHealth`, `selectFeatureSettingsHealth`, the hook's `health` and `getCapabilitySnapshot().state` expose:

| Health | Meaning | Execution behavior |
| --- | --- | --- |
| `loading` | Refresh in progress | Continue last valid matching snapshot; unknown fields use explicit compatibility below. |
| `loaded` | Matching successful snapshot younger than 30 minutes | Enforce explicit settings. |
| `stale` | Matching snapshot older than 30 minutes or refresh failed | Keep its known restrictions and availability; retry on natural lifecycle/manual trigger. |
| `unavailable` | No valid matching snapshot | Preserve legacy unknown-field behavior; employee attendance policy is still mandatory. |

Thirty minutes is a refresh threshold, not an authorization lease. `FeatureSettingsBootstrap` refreshes at session start and foreground if aged, plus Profile manual retry. There is no polling/server push revocation and no claim that a continuously open or offline app knows a server change immediately.

## Pure and execution policies

`isFeatureEnabled`, `isRouteEnabled`, `geoTaggingLevel`, `mergeFeatureSettings`, `featureSettingsHealth` and `services/capabilityPolicy.js:evaluateCapability` are pure and independently testable. Restriction flags and enum fields are not indiscriminately treated as feature availability.

`assertCapability(path, expectedOwner?)` reads persisted tenant/employee at request time, checks current authentication generation and suspension, and selects only that scope's Redux settings. It returns an owner snapshot containing no tokens. A known disabled operation throws an app-owned `FEATURE_DISABLED` error (`retryable=false`); existing service catch/return contracts remain unchanged. Tenant/employee/generation changes or suspended logout cleanup throw `CAPABILITY_SCOPE_CHANGED`. This closes retained-callback execution during logout before token removal finishes.

Feature services use that assertion at their boundary and pass the captured `capabilityScope` to Axios. `services/api/capabilityRequests.js:capabilityForRequest` centralizes exact endpoint/doctype/payload mappings. The `apiClient` request interceptor evaluates the current policy after its auth reads and on every 401 retry. An absolute request must belong to its captured tenant. Raw leave/expense/complaint/attendance-request attachment fetches capture scope and reassert immediately before `fetch`. Pending native registration and offline admission also recheck after awaited work.

The follow-up review strengthens destination checks to the **effective Axios URI**, including relative paths, `baseURL` and `allowAbsoluteUrls`. Four HR create/upload families also accept an app-owned operation scope; all discovered multi-step callers retain that original scope across create and attachment, rather than letting a successful document ID acquire a new tenant. These options do not change backend payloads. R4 additionally uses the existing `AutoAttendanceSlice` for scoped employee policy reception and enforces current mode at automatic monitoring, admission, POST and retry boundaries. See [07](07-FINAL_GAP_ANALYSIS.md) for reception ordering, cache compatibility, exact fixes and remaining backend/device limitations.

The backend-confirmed tenant geo veto extends the existing AUTO capability rather than adding a store: `isFeatureEnabled(settings, AUTO_ATTENDANCE)` returns false for normalized tenant geo level 0 (wire false/0/null), regardless of employee mode or `auto_attendance=true`. The same result reaches selectors/routes, service/transport guards and bootstraps. `assertCapabilityCurrent` supplies a final synchronous scoped Redux/auth-generation check after awaited ownership/employee work; registration, replay, queue admission/final INSERT and automatic POST use it. It complements existing persisted-owner validation and preserves unknown-field compatibility. Accepted outbox delivery and manual attendance do not use the new-action AUTO gate. Tenant geo 1 is not interpreted as warning-only or promoted to another mode.

Essential shared endpoints have explicit purposes. Public history browsing is guarded; private current-attendance status and tenant-verified positive-evidence queue reconciliation can use the shared history API without the optional history feature. Employee/profile, clock, totals and employee-status updates are not falsely mapped to document browsing or photo availability. The offline upload endpoint delivers accepted records and is deliberately distinct from new offline admission.

Confirmed tenant manual location flags are constraints, not permission to bypass employee policy. `manualAttendanceLocationPolicy` combines both sources, reuses assigned geometry/GPS and verifies proof at the service and shared Axios/retry boundaries. A tenant checkout exception releases only its own constraint. Employee mandatory restrictions remain. Cross-source manual overrides and tenant geo 1/true/missing semantics remain backend questions; tenant geo false/0/null is now resolved and enforced for automatic actions only.

## Lifecycle and tenant boundaries

| Event | Handling |
| --- | --- |
| Fresh QR/mobile login | Existing auth writes preserved; settings request uses one current auth context. |
| Cold start / restored session | PersistGate restores snapshot with owner; UI scopes it synchronously and services compare persisted provisioning. Bootstrap refreshes. |
| Tenant or employee switch | Foreign settings are not returned. Delayed requests/results cannot acquire a new owner; existing attendance queue rows retain their tenant. |
| Logout / expiry | Existing generation invalidation blocks new feature work immediately; REVERT_ALL clears feature/identity state. Attendance records remain durable. |
| Token rotation | Same-owner token refresh remains in apiClient; retry rechecks current feature policy and ownership. |
| Transport or settings failure | Last valid matching snapshot survives; malformed success cannot reenable known denied features. |
| Foreground | Settings refresh after threshold; automatic/offline lifecycle responds to received policy. |
| Background wake | Persisted same-scope policy plus employee config checks apply before submission; native capture is evidence, not authorization. |
| Live false while screen open | Route gate unmounts mapped screen; retained callbacks, timers, retries and service invocation still meet execution guards. |
| Policy flip during awaited work | Final scope/policy checks block new dispatch/admission. Already dispatched requests or an admitted DB write are not canceled retroactively. |

## Explicit unknown-field compatibility

`DEFAULT_WHEN_UNKNOWN=true` remains for missing/malformed fields and first-load outages. It does not apply to newly received explicit wire null, which persists as false. Pre-upgrade normalized null caches cannot distinguish original missing values from wire null; their lost provenance is an explicit migration limitation. Known false/null denials remain through failed/malformed/partial same-session refreshes. Logout clears capability caches; a fresh session with no answer again uses compatibility. A new tenant never inherits another tenant's explicit allow or deny. Manual constraint evaluation does not use the optimistic availability default to invent a restriction.

This policy is a remaining limitation: a first login/outage or never-sent key cannot enforce a denial the client has not received. Backend authorization must carry that responsibility. Moving optional capabilities to unavailable-by-default or introducing a backend version/complete-schema contract requires a deliberate migration, rather than silently breaking older tenants. New settings enums are not guessed, and mandatory mobile attendance-policy completeness remains enforced independently.

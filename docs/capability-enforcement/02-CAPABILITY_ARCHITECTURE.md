# Capability architecture and failure policy

## One existing authority, strengthened

The implementation extends `utils/featureSettings.js`, the persisted `redux/Slices/FeatureSettingsSlice.js`, the shared hooks and bootstrap. No dependency, capability context, duplicate feature store or persisted feature cache was introduced.

`getFeatureSettings` is the sole wrapper for `employee_app.gauth.employee_checkin_setting`. It accepts the auth context captured by the refresh caller so scope and actual request cannot come from different reads. Normalization accepts existing bare/Frappe `message`/`data` envelopes, Boolean/0/1/string forms, nullable versions and 0/1/2 or legacy geo labels. Missing/invalid fields remain null. An entirely unrecognized/empty success is now a failed refresh. Partial same-scope responses merge explicit values over the previous snapshot: omitted/malformed values cannot erase an earlier false. An explicit true can reenable a capability.

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

Essential shared endpoints have explicit purposes. Public history browsing is guarded; private current-attendance status and tenant-verified positive-evidence queue reconciliation can use the shared history API without the optional history feature. Employee/profile, clock, totals and employee-status updates are not falsely mapped to document browsing or photo availability. The offline upload endpoint delivers accepted records and is deliberately distinct from new offline admission.

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

`DEFAULT_WHEN_UNKNOWN=true` is an existing product/repository contract retained deliberately: older tenants omit newer settings, and first-load outages must not remove their job functions or essential attendance. This is not equivalent to asserting that a feature is authorized. Every received false stays false through failed/malformed/partial same-session refreshes. Logout intentionally clears capability caches; a fresh session with no answer again uses compatibility. A new tenant never inherits another tenant's explicit allow or deny.

This policy is a remaining limitation: a first login/outage or never-sent key cannot enforce a denial the client has not received. Backend authorization must carry that responsibility. Moving optional capabilities to unavailable-by-default or introducing a backend version/complete-schema contract requires a deliberate migration, rather than silently breaking older tenants. New settings enums are not guessed, and mandatory mobile attendance-policy completeness remains enforced independently.

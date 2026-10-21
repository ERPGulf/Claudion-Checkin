# Geo-tagging and location policy

Updated 2026-10-21 from the backend contract supplied in this task. This records confirmed field semantics and implemented client behavior; no live backend request or Android/iOS validation was performed.

## Confirmed manual location contract

`employee_app.gauth.employee_checkin_setting.attendance_action` now supplies an independent manual attendance constraint. `restrict_location=true` requires the employee's assigned location. `unrestricted_checkout_location=true` releases that source's checkout radius requirement only when restriction is enabled.

| Tenant restrict | Tenant unrestricted OUT | Manual IN under tenant rule | Manual OUT under tenant rule |
| --- | --- | --- | --- |
| false | false | Anywhere | Anywhere |
| false | true | Anywhere | Anywhere |
| true | false | Assigned location | Assigned location |
| true | true | Assigned location | Anywhere |

“Anywhere” removes that source's radius requirement; it does not waive authentication, employee policy completeness, the server request, or existing GPS requirements for an unrestricted checkout. The checkout flag is ignored for the tenant rule when tenant restriction is false. Explicit null disables the respective rule/exception: null restriction adds no tenant radius constraint; null checkout does not grant an exception to an enabled restriction.

The implementation reuses `getOfficeLocation`, `resolveLocationCoordinates`, `scoreLocations`, `pickNearest`, existing radii and Expo GPS. GeoJSON coordinates remain preferred over flat coordinates. No new distance algorithm, office selection or radius default was introduced. A missing assigned office or failed radius proof cannot authorize a restricted punch.

## Employee restrictions remain mandatory

Existing employee `restrict_location` and `unrestricted_checkout_location` remain independent requirements. A tenant relaxation cannot silently release an employee's mandatory radius rule. [manualAttendanceLocationPolicy.js](../../services/manualAttendanceLocationPolicy.js) isolates the combination:

- IN requires radius verification if either source requires it.
- OUT requires radius verification if either source restricts location and has not granted its own checkout exception.
- Each checkout exception releases only its own source's restriction.
- Missing/malformed tenant fields retain the existing employee behavior. A known tenant restriction without an explicit checkout exception requires the radius for OUT.
- Missing mandatory mobile employee flags still refuse attendance. QR provisioning defaults remain compatible.

| Tenant rule | Employee rule | Effective client behavior | Status |
| --- | --- | --- | --- |
| No restriction | No restriction | Both punches anywhere | Confirmed tenant table; existing employee behavior |
| Restrict IN/OUT | No restriction | Both require assigned location | Confirmed tenant constraint applies |
| Restrict IN, OUT exception | No restriction or matching employee exception | IN assigned; OUT anywhere with existing GPS/server requirements | Confirmed compatible combination |
| No restriction | Employee restricts IN/OUT | Both require assigned location | Mandatory employee restriction preserved |
| Tenant OUT exception | Employee restricts OUT without exception | OUT remains assigned | Conservative independent constraints; override precedence unresolved |
| Tenant restricts OUT without exception | Employee grants OUT exception | OUT remains assigned | Confirmed tenant constraint retained; cross-source exception precedence unresolved |

**Exact remaining backend question:** Are the settings and employee flags independent mandatory constraints, or is one an authoritative final override? Specifically, for tenant `(restrict=true, unrestricted_OUT=true)` and employee `(restrict=1, unrestricted_OUT=0)`, may tenant's OUT exception release the employee's mandatory radius? Conversely, for tenant `(true,false)` and employee `(1,1)`, may the employee exception release the tenant requirement? For tenant restriction false and employee restriction 1, confirm how conflicts should be resolved without weakening employee policy. Until a written cross-source contract exists, the client requires both sources to permit an outside punch. The individual tenant truth table is closed; cross-source override precedence is not claimed resolved.

## Execution and asynchronous work

`userCheckIn` captures tenant, employee, account and authentication generation even for direct calls. It reads scoped tenant settings plus current employee flags, verifies assigned-location proof when required, and rechecks after server-clock/GPS work. Proof is bound to the geometry actually scored. A changed requirement or changed geometry cannot reuse an old inside result.

The existing ordered employee receiver also records location facts as `autoAttendance.employeeLocationPolicy` in the existing persisted slice: scope, account, auth generation, request revision, known restriction/checkout flags and assigned geometry identity. Location-only responses can update these facts without erasing employee geotagging. Missing/malformed fields preserve a matching prior answer; foreign/obsolete responses cannot replace it. The final synchronous manual guard overlays these received facts over a potentially delayed legacy storage mirror, closing a restriction change during the final storage/ownership await. Radius proof must match the received geometry and the mirror actually used. A rejected incomplete mobile response may tighten a constraint but cannot release one or replace geometry; a legitimate complete later response may release it. No additional store, native policy mechanism or auth flow was introduced.

The shared Axios request policy rechecks manual location policy before dispatch and every 401 retry. Service-owned evidence stays on app-only request metadata; it is not added to the backend payload. Direct manual Axios requests cannot skip an applicable location constraint by omitting proof. Tenant switching and reauthentication reject old operations. Already-dispatched same-owner success remains accepted after policy changes; manual reconciliation remains in the existing session authority.

An allowed outside checkout still obtains its existing office/GPS metadata and server timestamp, and sends the normal online request. Missing GPS or failed clock/transport remains a refusal; an outside exception is not offline acceptance. Automatic ENTER/EXIT is unchanged and does not reapply the manual radius gate: EXIT is departure evidence. Previously accepted offline rows remain scoped delivery obligations.

## Explicit null versus missing policy

Backend-confirmed Boolean capability wire null normalizes to disabled `false`; it is a received answer and replaces a cached true. Missing, undefined and malformed values remain unknown in the normalized representation and cannot erase a previous same-scope known answer. Existing request IDs and scope checks reject obsolete responses. Entire malformed bodies, including a null `attendance_action` container with no recognized fields, do not disable all child fields by inference.

New received null denials persist as false through JSON/Redux hydration, refresh failure and cold start. A foreign scope never supplies another tenant's policy. Pre-upgrade normalized caches used null for both missing and explicit wire null, so their original provenance cannot be reconstructed safely: those old ambiguous values retain unknown compatibility until a valid refresh. This migration limitation remains in R5. `offline_attendance_version` is metadata: explicit null clears its cached string without granting or denying offline attendance.

## Geo-tagging response types and scope

| Tenant wire `geo_tagging` | Normalized level | Refresh behavior | Effect on employee automatic enum |
| --- | --- | --- | --- |
| false | 0 | Explicit disabled tenant value replaces an older level | Mandatory veto of new automatic IN/OUT and automatic monitoring, even employee mode 2 |
| 0 / `"0"` | 0 | Known disabled level | Same mandatory tenant veto |
| 1 / `"1"` | 1 | Known numeric level; meaning unconfirmed | No new mode cap or grant inferred; other existing checks continue |
| 2 / `"2"` | 2 | Known level | Does not raise employee modes 0/1 or bypass the automatic feature flag |
| null | 0 | Explicit disabled tenant value replaces an older level | Same mandatory tenant veto; never unknown/allowed |
| Missing | Unknown | Retains an earlier same-scope level, otherwise unknown | Unchanged |
| Malformed / Boolean true | Unknown | Retains an earlier same-scope level, otherwise unknown; true never grants level 2 | Unchanged |

False/null use the existing canonical raw representation `'0'` with `geo_tagging_level=0`. **New backend confirmation closes the disabled override:** tenant false/0/null always prohibits automatic geofence IN/OUT regardless of employee mode. The existing `isFeatureEnabled(..., AUTO_ATTENDANCE)` and centralized capability policy now include that veto; route/hooks, registration, background processing, direct services, offline admission and Axios/401 retries share it. Final synchronous checks after employee/native/GPS/clock/DB awaits prevent stale grants from dispatching. Automatic monitoring is stopped when running JS receives the disabling policy. Native evidence remains retained; no native architecture changed.

Accepted offline attendance is still delivered through its separately scoped endpoint without this new-admission veto. Manual IN/OUT uses its existing location policy and is never disabled solely by tenant geo. Missing/malformed refresh fields retain a prior known same-scope geo denial; fresh missing policy remains distinct and retains existing compatibility. Foreign tenant settings never supply an enable or denial to the current owner.

**Still required from backend:** what does tenant geo 1 mean, particularly with employee mode 2? Is Boolean true supported? What are missing-field semantics? These values do not invent a warning-only cap, a grant or an employee-mode upgrade. Existing nonzero/unknown compatibility remains until confirmed; uncontrolled production use of unresolved combinations is not approved. No `min(tenant, employee)` rule was introduced. Legacy select labels remain parser-compatible.

When tenant policy does not veto automatic functionality, employee `get_employee_data.geotagging` and R4 enforcement remain:

| Employee mode | Monitoring | New automatic IN/OUT |
| --- | --- | --- |
| 0 | Off | Denied |
| 1 | Eligible with opt-in, geometry and permissions | Denied; warning-only evidence |
| 2 | Eligible with opt-in, geometry and permissions | Eligible through current policy and the shared session transition |

Tenant `auto_attendance=false` or explicit null independently disables that Boolean feature. Tenant geo false/0/null vetoes it even if `auto_attendance=true` and employee mode is 2. Tenant `offline_attendance=false` or explicit null blocks new offline admission without deleting or stopping safe delivery of accepted rows. Manual radius flags do not change automatic EXIT departure semantics. DV-04/05/06/13 and physical Android/iOS behavior remain NOT RUN; source/test evidence and release gates are in [07](07-FINAL_GAP_ANALYSIS.md) and [09](09-RELEASE_READINESS.md).

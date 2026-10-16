# Geo-tagging and location policy

## Verified enum and runtime meaning

The repository establishes these employee `get_employee_data.geotagging` modes in `redux/Slices/AutoAttendanceSlice.js:GEOTAGGING`, its labels and selectors, and the `autoAttendanceSlice`, `autoAttendanceRegistration`, `AutoAttendanceBootstrap.checkout` and `autoAttendanceEventProcessor` tests:

| Value | Monitoring | Automatic attendance | Warnings |
| --- | --- | --- | --- |
| 0 | Off | No new automatic IN/OUT | Disabled policy copy |
| 1 | Eligible with employee opt-in and permissions | No punches from crossings | Reliability warnings/detection only |
| 2 | Eligible with employee opt-in and permissions | Crossings can become IN/OUT through the shared session transition | Reliability warnings |

These are established application semantics, not newly inferred backend definitions. The available repository has no backend implementation with which to independently validate them. `utils/featureSettings.js:geoTaggingLevel` accepts the settings field `geo_tagging` in numeric 0/1/2 form and legacy ERPNext select labels. Unknown enum values remain unknown in settings and normalize disabled in the employee automatic-attendance slice.

Automatic monitoring also requires configured office geometry and OS permissions; the durable registrar verifies full accuracy. `userEnabled` remains the employee's opt-in. Tenant `attendance_action.auto_attendance=false` now independently blocks registration and automatic submission, stops monitoring when received, and prevents retained native receipts from becoming new punches. It does not delete earlier attendance queue rows.

## Independent policies and their current precedence

| Policy | Existing authoritative execution data | Effect |
| --- | --- | --- |
| Manual location restriction | Employee `restrict_location`, provisioned/cached in legacy keys | A value of 1 requires a usable office and a current fix within its radius for manual IN and ordinarily OUT. |
| Unrestricted manual checkout | Employee `unrestricted_checkout_location` | A value of 1 skips the OUT radius restriction; the existing service still obtains location metadata. IN remains restricted when employee `restrict_location=1`. |
| Automatic attendance mode | Employee `geotagging` | 0/1/2 semantics above; independent from manual radius policy. |
| Automatic feature switch | Settings `auto_attendance` when supplied | Explicit false blocks new automatic actions/registration, regardless of employee mode/opt-in. Missing field retains the established compatibility behavior. |
| Offline attendance switch | Settings `offline_attendance` | Explicit false blocks new offline attendance queue creation. It neither enables automatic attendance nor stops safe delivery of pre-existing rows. |
| Attendance photo availability | Settings `photo_upload` plus employee `photo` | Both must permit the camera flow; disabling photo availability leaves essential direct attendance available. |

An OS ENTER/EXIT supplies location evidence for automatic actions. `services/api/attendance.service.js:autoCheckInOut` deliberately does not reapply the manual radius gate: EXIT is outside by definition. `services/offline/offlineAttendanceGate.js:evaluateOfflineAttendance` mirrors this with `enforceRadius=false`, while the durable event processor validates tenant, employee, registered geometry, fingerprint, capture mode and current employee mode. A GPS snapshot can select an office or restore server state; it does not itself create an attendance transition. Initial presence requires an actual OS callback and respects a manual checkout during that registration.

## Unresolved backend contract

`attendance_action.geo_tagging`, `restrict_location` and `unrestricted_checkout_location` overlap employee policy data, but their precedence is not established. Existing code explicitly kept them out of employee enforcement (`hooks/useAttendanceAction.js`, attendance sub-feature policy comment), and `docs/auto-attendance-sdk/07-OPEN_QUESTIONS.md` P-11 records the source-of-truth question. This work does not invent a tenant-versus-employee merge, infer that settings `geo_tagging=0` overrides an employee mode, or relax mandatory employee restrictions. Consequently those three settings fields remain **Unverified** as authoritative replacements and are rollout limitations of the requested end state.

Backend owners must confirm whether these settings are feature availability, defaults, resolved employee policy or independent requirements, including each conflict combination. In particular, a tenant restriction false must not silently make a location-restricted employee unrestricted, and a warning-only mode must not become enforced/manual attendance denial. Native/device behavior and live tenant responses require staging validation.

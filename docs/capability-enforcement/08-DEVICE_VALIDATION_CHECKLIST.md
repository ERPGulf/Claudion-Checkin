# Device validation checklist

Prepared on 2026-10-16. **No Android or iOS device, simulator, native build or live backend scenario in this checklist has been executed for this review. All platform results below are NOT RUN.** Jest results establish JavaScript behavior under mocks; they do not establish these results. Record executions separately from this initial checklist.

## Setup and evidence

- Use disposable staging tenants A and B, synthetic employees and disposable HR documents. Include the same employee code in both tenants and a second employee in A. Use both QR/password and mobile sign-in without changing their flows. Backend owners must supply actual policy responses and permitted test accounts.
- For automatic attendance, use Android and iOS native builds exposing `getPendingEvents` and `acknowledgeEvent`; confirm `supportsDurableEvents()` is true. Record app version, native build, runtime/channel and JavaScript revision. An OTA cannot add the native module or durable APIs. Legacy-binary checks are separately identified below; legacy historical replay is deliberately refused when capture-time ownership cannot be established.
- Run on a physical Android device with Play Services and a physical iPhone. Record OS/device, location accuracy, foreground/background authorization and battery settings. Repeat Android background cases with standard battery settings and a restrictive OEM setting; repeat iOS cases with Precise Location and Always authorization, then record reduced accuracy/Low Power Mode separately. Simulator location injection can supplement physical runs, but record it as simulator evidence.
- Use an approved staging proxy or fault-injection harness to delay a response, return a controlled 401 or fail transport. Do not alter production data or interpret an arbitrary network error as proof that authorization worked. For background crossings, use real office-radius crossings; record arrival, capture, processing and server times because OS delivery may be delayed.
- Capture a sanitized settings/employee response, tenant alias, employee alias, capability health/scope, screen recording, request endpoint/method/status/time, server document IDs, queue row/event IDs and before/after counts. Compare server attendance/attachments against the original document and owner. Do not export Authorization headers, tokens, passwords, OTPs, lookup configuration or full employee records. Existing diagnostic logs can contain sensitive fields; redact before sharing.
- Use Profile's settings retry to receive policy, or the existing settings refresh in a staging test harness while the target screen remains mounted. Foreground refresh is throttled at 30 minutes; backgrounding alone does not prove a new response was received. The harness must call the existing refresh path, not dispatch an invented policy shape or bypass scope checks.

For each result record tester/date, build/device, reproduction variant, artifact links and observed versus expected request/row counts. Use **PASS**, **FAIL** or **BLOCKED** only after execution; retain **NOT RUN** otherwise. A backend document created before revocation is a real side effect and must be accounted for even if a later attachment is refused.

## How to interpret revocation

| Observation | What can be asserted |
| --- | --- |
| Administrator changed policy on the server; device has not received it | This is server revocation. Backend authorization must enforce it. The client may still use its last same-scope snapshot; there is no instant push or capability lease. |
| Device received an explicit same-scope feature denial | This is fetched-policy revocation. New protected dispatches, retries, native registration and queue admission must honor it. A request already dispatched cannot be recalled. |
| Device is offline with a cached snapshot | Cached/offline behavior applies. Previously received denials remain denials. Cached allows have no hard expiry; unseen changes cannot be enforced locally. Unknown fields retain documented compatibility availability. |
| Employee mode changes from 2 to 0/1 | This is employee-policy revocation, distinct from tenant `auto_attendance`. Current-mode execution/admission/retry checks now have source and Jest coverage; device validation remains DV-13. Do not substitute a tenant-denial test for this case. |

Source: [FeatureSettingsBootstrap.jsx](../../components/FeatureSettingsBootstrap.jsx#L12), [capabilityPolicy.js](../../services/capabilityPolicy.js#L70), [attendanceConfigCache.js](../../services/offline/attendanceConfigCache.js#L40). Tenant `geo_tagging` versus employee `geotagging` precedence is unresolved; obtain the backend answer recorded in [07-FINAL_GAP_ANALYSIS.md](07-FINAL_GAP_ANALYSIS.md) before asserting a conflict combination is correct.

## DV-01 — Feature disabled at login

**Android: NOT RUN. iOS: NOT RUN.** Repeat modern/legacy presentation and light/dark themes.

1. Configure an explicit false for each mapped optional feature in turn: loan, expense, leave, complaints, records, resignation, attendance request/history, photo, break, offline and automatic attendance. Set employee geotagging to 2 for the automatic case and employee photo to 1 for the photo case so the tenant denial is the cause.
2. Sign in; verify the settings response belongs to the current tenant/employee and contains the denial. Test immediate first-login behavior before the response separately: availability may be optimistic and is not a passed denial test.
3. Inspect Home/Quick Access and attempt a saved shortcut or supported retained route. In a staging developer harness, invoke the corresponding exported service directly using the active account.
4. For automatic/offline denial, attempt an OS crossing/new admission; for photo/break denial, attempt the attendance action and inspect network requests.

Expected/pass: received denial hides or blocks its route and produces no new optional request, upload, automatic punch or prohibited queue admission. Essential manual attendance/status remain usable under employee policy; photo/break disablement does not block direct attendance. Existing accepted rows are handled in DV-06. Fail on a protected request after the received denial, a direct-service bypass or a core attendance refusal caused solely by optional-feature disablement.

## DV-02 — Feature disabled while its screen is open

**Android: NOT RUN. iOS: NOT RUN.** Repeat both presentation variants for HR/history/automatic routes and the shared camera route.

1. Open an enabled feature; populate an unsent form. For photo, keep Attendance camera open before capture and again after capture. For breaks, leave an active break running.
2. Change only the target feature to false on staging. While the screen is still mounted, receive the new settings through the existing refresh path; record reception time.
3. Tap a retained submit/capture/break callback; allow a break auto-end timer to expire and then attempt manual checkout.

Expected/pass: gated route responds to denial; a retained callback or timer sends no protected read/mutation/upload. A denied break is not silently erased, and checkout can proceed without ending it through the disabled break API. A denied photo flow cannot submit from its stale camera callback; return to the available direct attendance path and verify it works. Fail on a new protected call, a captured photo being uploaded after denial or mandatory employee radius checks being weakened.

## DV-03 — Feature disabled while an API request is pending

**Android: NOT RUN. iOS: NOT RUN.** Include Axios HR/history/break, attendance photo association and raw HR upload paths.

1. Start an enabled optional read/mutation and hold its response at the proxy. Record whether the original request has already reached the backend.
2. Receive the target capability false before releasing a delayed success. Account for an original mutation that was already dispatched; do not expect a client check to undo it. Verify no subsequent feature action/upload starts after denial.
3. Repeat with a held 401: receive the denial, allow the normal refresh outcome, then release/complete the retry sequence. Count original and repeated feature requests separately.
4. Repeat with a tenant switch or logout/reauthentication while the response is pending, then release it.

Expected/pass: no feature retry after received denial and no follow-up attachment/action. A same-owner operation already dispatched may complete once. An old-owner response/401 cannot mutate the new session, refresh the new account for the old request or launch a follow-up under its credentials. Raw uploads have no invented automatic retry. Fail on a second protected request after denial, wrong-owner follow-up or duplicate HR/attendance side effect. Inspect server logs to distinguish an already dispatched insert from a forbidden new dispatch.

## DV-04 — App backgrounded when automatic attendance is disabled

**Android: NOT RUN. iOS: NOT RUN.** Requires durable native build.

1. Set employee mode 2, valid office geometry and tenant automatic availability true; opt in, grant background/precise location and verify exactly the intended fence is registered.
2. Background and lock the device. Change tenant `auto_attendance` to false on staging, then cross the office boundary. Observe whether JS actually ran and received settings; do not assume it did.
3. Foreground, explicitly receive false, and inspect registered fences plus captured event/queue/server counts. Cross again after the received denial.
4. Android: repeat after a reboot with a previously persisted registration. iOS: repeat suspended and after ordinary termination; record user force-quit separately without assuming the OS will relaunch the app.
5. Repeat keeping `auto_attendance=true` and employee mode 2, changing **only tenant geo** from 2 to false, 0 and null in separate runs. Receive it through the real settings refresh and require the same stop/no-new-punch behavior. Hold employee refresh/GPS/native completion during revocation to expose delayed starts.

Expected/pass: native may capture under its old configuration while JS lacks new policy. Once JS receives false, monitoring stops and retained receipts do not create new punches or new attendance rows. No authenticated native attendance POST exists. Fail on new JavaScript authorization after received denial or monitoring restarting from a stale pending registration. Server refusal before client reception is a separate backend check in DV-14.

## DV-05 — Native event arrives after revocation

**Android: NOT RUN. iOS: NOT RUN.** Requires durable native build.

1. Start monitoring in employee mode 2 and save the active registration fingerprint/owner. Hold native registration completion or an event transfer using the staging harness where reproducible.
2. Receive tenant `auto_attendance=false`. Deliver the delayed real native receipt, or allow a boundary callback already in transit to reach the bridge.
3. Repeat with app relaunch/reconnect so the native journal is ingested again; inspect native acknowledgment and SQLite event status separately from attendance queue status.
4. Repeat with `auto_attendance=true`, employee mode 2 and only tenant geo disabled to false/0/null. Test delayed ENTER and EXIT independently. A tenant switch cannot apply another tenant's geo grant or reinterpret the old receipt's owner.

Expected/pass: a receipt can transfer to durable SQLite and be acknowledged only after its insertion commits. It remains attributable and pending with a refusal reason; no new attendance POST/queue row/session transition occurs. This applies to geo false/0/null even with employee 2 and auto true. A registration completing after denial is stopped. Repeated transfer does not duplicate attendance. Accepted rows from before revocation still synchronize under their original owner (DV-06); manual attendance remains available under its own policy. Fail on any prohibited new punch, loss/reassignment of ownership or acknowledgment without a committed durable copy. A pending receipt is not an accepted punch.

## DV-06 — Offline punch accepted before policy changes

**Android: NOT RUN. iOS: NOT RUN.** Requires durable native build and a known working offline endpoint.

1. Download complete scoped employee configuration with mode 2 and tenant automatic/offline availability true. Disconnect transport, cross ENTER then EXIT, and verify accepted queued IN/OUT with original owner, timestamps and pairing. Record queue IDs and distinguish local acceptance from server confirmation.
2. On staging, disable offline and automatic attendance. Reconnect and receive the denials while retaining the accepted queue.
3. Wait for/retry normal delivery. Compare server IN-before-OUT ordering and exactly one record per upload. Attempt a subsequent crossing/admission after denial.
4. Where a retained pre-existing manual/photo queue fixture is available, repeat with photo upload disabled. Do not create a new manual offline punch: manual punches are online-only.

Expected/pass: accepted rows remain and deliver only under their original tenant/employee, without new automatic/offline admission. Pairing, claim ownership, timestamps and deduplication remain intact. An ambiguous prior request requires positive server evidence before resend. Photo denial can prevent a new attachment while attendance delivers; the original photo URI remains recorded, and a synced row does not imply its attachment succeeded. Fail on lost/reassigned rows, reordered/duplicate attendance, new admission after denial or false attachment success. Confirm backend support for historical delivery in DV-14.

## DV-07 — Tenant switching with pending attendance records

**Android: NOT RUN. iOS: NOT RUN.** Include identical employee codes across A/B and a different employee.

1. In A, accept offline IN/OUT and retain a native receipt; hold a service response, settings response and a queue upload in separate runs. Capture A's settings scope and original row/event IDs.
2. Switch successfully to B through the existing provisioning/sign-in flow. Configure opposite capabilities in B; repeat both A-enabled/B-disabled and A-disabled/B-enabled combinations. For the same-employee-code variant, ensure the backend origins differ.
3. Release A's delayed responses, reconnect and inspect B's screen/settings, automatic registration/session and requests. Try a fresh B operation that B permits.
4. Return to A and inspect/recover A's retained records under A credentials.

Expected/pass: B never uses A's capability snapshot or uploads/attaches A's attendance. A's rows/events remain attributable and retained; an in-flight operation either remains accounted for under A or refuses further work after scope change. Fresh B operations follow B policy; returning to A permits safe A-only recovery. Unknown legacy rows are not assigned B by inference. Fail on any cross-tenant capability reuse, request/document ownership mismatch or discarded accepted record.

## DV-08 — Cold start without internet; failed/partial/stale settings

**Android: NOT RUN. iOS: NOT RUN.** Repeat QR and mobile established sessions; this is not cold-boot authentication.

1. Receive explicit optional-feature denials and a valid employee attendance policy. Force the app process closed, disconnect transport and relaunch the persisted session. Attempt denied features, manual attendance and a captured automatic event.
2. Repeat after an enabled same-scope snapshot ages beyond the 30-minute settings refresh threshold and six-hour employee refresh threshold. Remain offline, then reconnect with the settings API unavailable.
3. Repeat with a malformed successful settings response, then a partial response omitting a previously denied field, then an explicit re-enable. Verify latest-response ordering using a delayed earlier response.
4. Repeat a fresh session with no feature snapshot, and logout/reauthentication where caches are cleared. Record actual unknown/default availability; do not classify it as explicit authorization. For automatic offline replay, repeat with no scoped employee cache and a foreign-scope cache.

Expected/pass for current contracts: cached explicit denials survive restart, age, failed/malformed/partial refresh and cannot be overwritten by an obsolete response; an explicit valid re-enable can restore availability. Old enables have no hard expiry. Unknown optional settings retain optimistic compatibility behavior and are an unresolved production authorization limitation. Manual offline attempts create no queue row; lack of scoped employee configuration prevents new durable automatic attendance. A foreign cache never supplies another account's policy. Fail on a known denial turning into allow after malformed/partial/error, identity leakage or a manual punch reported as saved offline. Record unknown permissiveness as the known release gap rather than a successful strict-authorization result.

## DV-09 — Confirmed manual location combinations and outside checkout

**Android: NOT RUN. iOS: NOT RUN.** Repeat employee modes 0/1/2 and both attendance presentations, using online connectivity.

1. Start with unrestricted employee flags and usable assigned reporting locations. For each tenant combination `(restrict, unrestricted_OUT)` false/false, false/true, true/false, true/true, perform IN and OUT inside and clearly outside the radius. Require exactly the truth table in `03`, including ignoring checkout when tenant restrict is false.
2. Check in inside the office, move clearly outside the configured radius, keep foreground GPS authorized and obtain a current fix. Tap manual OUT.
3. Repeat using employee `restrict_location=1`, `unrestricted_checkout_location=1`, then employee checkout exception 0. Tenant relaxations must not release a mandatory employee restriction. Conflicting exceptions retain both constraints until backend precedence is resolved. Deny permission/remove GPS availability and record that distinct result.
4. Delay GPS, the server-clock response and a 401 refresh in separate runs. Revoke the applicable checkout exception with false and null, or enable restriction. Change assigned geometry while GPS is pending; an old inside result cannot prove the new office. Repeat tenant switching and same-owner reauthentication while work is held.

Expected/pass: OUT can succeed outside only when both applicable sources permit it, with existing GPS/clock/request requirements. Restricted IN and OUT without all necessary exceptions require assigned-radius proof. No post-revocation retry, stale geometry proof or changed-owner dispatch is allowed. GPS failure on an otherwise permitted checkout is distinct from radius refusal. Tenant geo remains unresolved. Record FAIL for a truth-table violation, weakened employee restriction, unauthorized retry/owner change or stale-proof acceptance; record BLOCKED if a required race cannot be placed. These scenarios remain NOT RUN on devices.

## DV-10 — Delayed attachment picker and native permission callbacks

**Android: NOT RUN. iOS: NOT RUN.** Repeat camera/gallery/documents for expense, leave, complaints, attendance request and any other picker consumer; include modern and legacy complaint presentation.

1. Open an enabled form's attachment sheet. Select a picker action that runs after the 400 ms sheet-close timer. Receive owning-feature false or navigate away during that delay; repeat logout and same-account reauthentication.
2. With first-use OS permissions, hold the camera/gallery permission dialog. Receive denial or change account before answering; then grant permission.
3. Repeat with a picker already open: receive denial/change scope, then select a file and return. Repeat a normal enabled same-owner selection to verify the control case.

Expected/pass: no new native picker launch after denial/unmount/session invalidation; a permission callback cannot launch the next native action after revocation. A previously opened picker may remain under OS control, but its returned file is discarded and no upload follows. The enabled current-owner control still returns a file. Fail on a late camera/gallery/document launch, stale file accepted by the form or new upload. Capture timer/permission/denial ordering so a fast tap alone is not mistaken for a race reproduction. Evidence: [useAttachmentPicker.js](../../hooks/useAttachmentPicker.js#L29), [useComplaint.js](../../hooks/useComplaint.js#L60).

## DV-11 — HR creation followed by attachment under a changed owner

**Android: NOT RUN. iOS: NOT RUN.** Repeat expense, leave, complaint and attendance request; include 401 retry where applicable.

1. In A, select an attachment and submit an enabled form. Hold the create response after A has inserted a disposable document and record its A document ID.
2. Switch to B or logout/reauthenticate before releasing the response. Configure the feature enabled in B as well, so a capability-only check cannot hide an ownership bug. Release the response and observe attachment/refetch work.
3. Reproduce the narrower inter-step race: allow A's create response to finish successfully, then hold the follow-up upload's auth read before dispatch. Switch to enabled B while that read is pending and resume it. The upload must retain A's captured owner and refuse; a response-interceptor-only test does not cover this ordering.
4. Repeat with same-owner capability revocation between create and upload. Repeat a normal same-owner enabled submit with attachment.

Expected/pass: an A document ID never travels to B's upload endpoint/token, and a new generation cannot continue A's operation. Same-owner received denial blocks the attachment even when creation already happened. The normal control creates and attaches to the correct document. Account for an A create already dispatched, and avoid interpreting attachment failure as rollback of that create. Fail on cross-owner upload, stale completion being applied to B's form/session or duplicate creation caused by retry. Evidence: [expense.service.js](../../services/api/expense.service.js#L72), [useAttendanceRequest.js](../../hooks/useAttendanceRequest.js#L283).

## DV-12 — Legacy unowned historical replay is retained

**Android: NOT RUN. iOS: NOT RUN.** Requires a separately identified older binary without durable event APIs; not the preferred automatic-attendance staging build.

1. With employee A, allow native to record an ENTER/EXIT while JS is absent. Save its timestamp and the prior processing high-water mark; use an event within the existing replay window.
2. Relaunch with A, then repeat logout/sign-in as B and re-enable monitoring while the same unowned record remains. Exercise same-code/different-tenant identity as well.
3. Verify historical event inspection sends no automatic attendance, does not change the actionable event's processing mark, and does not clear native evidence. Then produce a fresh observed same-owner live crossing.
4. Hold a fresh live crossing at queue-count work, switch tenant or reauthenticate, and release it.

Expected/pass: no historical event is submitted as A or B without capture-time ownership; fresh current-owner live events still work. A stale pending live callback cannot submit or commit a new owner's session. Accepted queue rows are preserved separately. Existing expired-event/high-water handling remains, so verify actionable retention and expiry as distinct variants. Fail on historical submission, ownership reassignment, native evidence deletion for the refused actionable event or stale live callback execution. This safety behavior reduces historical automation on older binaries; it does not give them durable replay. Fresh-live binding identifies the current JS observer, not proven original native registration/capture ownership; stale native-registration provenance cannot be closed on these older APIs. Evidence: [AutoAttendanceBootstrap.jsx](../../components/AutoAttendanceBootstrap.jsx#L259), [autoAttendance.characterization.test.jsx](../../__tests__/autoAttendance.characterization.test.jsx#L460).

## DV-13 — Employee mode enforcement and pending execution

**Android: NOT RUN. iOS: NOT RUN. R4 client fix and Jest regressions verified; physical-device/native validation remains required. Do not mark passed from mocked tests or tenant capability tests.**

1. Keep tenant `auto_attendance=true` and other settings unchanged. At login test employee modes 0, 1 and 2 separately, with opt-in, valid geometry and granted permissions. Inspect actual OS registration, native receipts, online POSTs and queue rows. Mode 0 must not monitor or punch; mode 1 may monitor/warn but must not punch; mode 2 is the authorized positive control.
2. Start in mode 2. Hold automatic work at a location/permission, server-clock, native-registration or database-preparation await in separate harness runs. Receive a real same-owner employee response with mode 0, then repeat with mode 1. Record reception revision/scope and native/request/INSERT times. Release the old await; no new punch or queue INSERT may follow. Mode 0 must stop monitoring; mode 1 may reconcile a warning-only registration.
3. Return 401 for the first automatic POST. Hold token refresh, receive mode 0/1, then finish refresh. Require exactly the original POST and no second automatic POST. Repeat with direct Axios and direct automatic service/queue calls so UI/bootstrap refusal alone cannot satisfy the result. A token refresh itself remains permitted.
4. Suspend processing while backgrounded; receive mode 0/1 through the running JS refresh path, then deliver an old mode-2 native geofence event. No new punch/admission may occur. Durable evidence remains attributable/retained. Also record behavior while JS is absent: native capture can follow its stored configuration until current policy reaches JS, and must not be described as instant server revocation.
5. Delay an old mode-2 employee response, receive a newer mode 0, then release the older response. Confirm no re-enable. Reverse modes to prove a newer mode 2 survives an older mode-0 response/cache. Test a cache with a later timestamp, and no cache, after receiving the authoritative update.
6. Re-enable mode 2 through a legitimate later response and require a fresh authorized action. On a compatible legacy binary, set `offline_attendance=false`, remove the offline cache, receive mode 2 and prove fresh live online automation still works. Do not test unowned historical replay as a valid new action.
7. While a native event, GPS/clock read or 401 is pending, switch tenants using synthetic employees with the same code; repeat reauthentication to the same owner. The old operation must not submit under the new generation. New owner's fresh mode-2 work must still function; foreign caches must never authorize it.
8. Accept an offline row in mode 2, receive mode 0/1, reconnect and require that exact accepted row to synchronize once under its original tenant/employee. Do not add another row or delete/relabel the first. Repeat existing accepted-row recovery and an already-dispatched same-owner HTTP success after revocation: both remain accepted evidence.
9. Run manual IN and employee-authorized outside-radius OUT controls after automatic revocation. Existing mandatory location checks, online-only manual behavior and the checkout exception must remain unchanged.

Pass only with recorded Android/iOS request, registration and row evidence for each variant: current-mode checks must govern every new action, old cache/response must not override the current receipt, and accepted attendance must survive. A request/INSERT already submitted before reception cannot be recalled. If a harness cannot place a real employee response in a required gap, record **BLOCKED**, not PASS. Record **FAIL** for any prohibited post-reception dispatch, retry/admission, owner change or loss of accepted attendance. Tenant geo precedence remains a separate backend question.

Evidence: [employee policy](../../services/employeeAutoAttendancePolicy.js#L1), [POST/retry](../../services/capabilityPolicy.js#L94), [service](../../services/api/attendance.service.js#L489), [admission](../../services/offline/AttendanceQueueRepository.js#L190), [integration regressions](../../__tests__/automaticEmployeePolicy.integration.test.js#L1). These client tests do not establish OS delivery, background wake, native stop timing or backend authorization.

## DV-14 — Backend authorization independent of client gates

**Android: NOT RUN. iOS: NOT RUN. Backend verification: NOT RUN.** Backend owner participation and authorized disposable staging requests are required.

1. With a staging employee lacking a feature, independently exercise its read, create/mutation and attachment endpoints through the backend owner's approved API test method. Include break reads/mutations, history, photo association/upload and HR upload document ownership. Preserve endpoint payload/content-type contracts.
2. Change policy on the server while the app still holds a previously enabled snapshot. Attempt an operation before client refresh, then repeat after the app receives denial. Correlate server authorization and client request timing.
3. Attempt another staging tenant/employee's document ID with the current staging account through the authorized API test; verify server ownership checks. Test token expiry/revocation independently from a feature toggle.
4. Confirm the backend's intended acceptance of historical rows queued before offline/automatic disablement, including duplicate and ambiguous-outcome reconciliation. Record the resolved rule; retain rejected/blocked/review data without relabeling it.

Expected/pass: backend independently refuses unauthorized reads, mutations and attachments, validates tenant/employee/document ownership and does not rely on a hidden route or app build. An administrative UI setting alone is not evidence of endpoint authorization. Historical delivery follows an explicitly confirmed backend contract. Fail or block production readiness if security enforcement/ownership or historical acceptance is absent/unverified. Do not use production credentials or describe unperformed API probes as results.

## Completion record

All fourteen cases remain **Android NOT RUN / iOS NOT RUN** at publication of this checklist. Backend authorization and native/device behavior remain unverified. For controlled staging, record each failed/blocked variant against [09-RELEASE_READINESS.md](09-RELEASE_READINESS.md), including the employee-policy HIGH gap, unknown/stale compatibility and unresolved tenant geo precedence. A successful JavaScript suite, simulator-only run or one successful fence crossing does not close the unexecuted platform variants.

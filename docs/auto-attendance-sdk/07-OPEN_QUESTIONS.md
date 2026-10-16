# 07 — Open Questions

Nothing here has an answer in the repository. Each item states the current behaviour (verified where marked **[V]**), why it matters, and which milestone in [05](05-EXTRACTION_PLAN.md) it blocks. Do not invent answers; record decisions in this file when they are made.

---

## A. Product decisions

| ID | Question | Current behaviour | Why it matters | Blocks |
| --- | --- | --- | --- | --- |
| P-1 | Should a transition replayed after a cold start be attributed to the scope that was active when monitoring was configured? | Replays get no scope; if queued they become `tenantKey NULL` rows that are never sent and stall the employee's queue **[V]** | Largest payroll-integrity risk (RK-01) | M8.1 |
| P-2 | What should happen to existing NULL-tenant rows already on devices? | Shown as "Cannot verify company … will not be resent automatically" **[V]** | Recovery of historical attendance; forensic audit forbids inventing a tenant | M8.1 |
| P-3 | Should presence reconciliation check an employee in again after a manual check-out while they are still inside? | Yes, on every launch/background wake **[V]** | Unexpected attendance logs (RK-07) | M8.4 |
| P-4 | Should presence run only when monitoring is first registered, or on every start? | Every start **[V]** | Battery, network, RK-07 | M8.4 |
| P-5 | Monitor all of an employee's reporting locations, or only the nearest? | Nearest at registration **[V]** | Multi-site employees are not covered (RK-13) | M8.3 |
| P-6 | When the server changes an office location/radius, must the device fence update automatically? | Not updated while monitoring **[V]** | RK-05 | M8.3 |
| P-7 | Minimum dwell time / debounce at the boundary? | None **[V]** | Flapping creates multiple sessions (RK-09) | M8 (new item) |
| P-8 | Should automatic attendance respect shifts or time windows (e.g., no automatic IN at 03:00)? | No shift logic **[V]** | Spurious check-ins after reboot/upgrade inside the fence | M8 (new item) |
| P-9 | Should the opt-in survive a forced logout (token expiry) for the same employee? | No — `REVERT_ALL` resets it **[V]** | Silent disablement (RK-08) | M8.10 |
| P-10 | Should `attendance_action.auto_attendance = false` stop monitoring, or only hide the screen? | Resolved by the capability-enforcement task: false stops JS registration/monitoring and new automatic actions; accepted attendance remains deliverable. See `../capability-enforcement/04_OFFLINE_AND_BACKGROUND_ENFORCEMENT.md`. | Native while-JS-absent behavior still needs device validation | M8.11 |
| P-11 | Which policy source is authoritative: per-employee `geotagging` (`get_employee_data`) or feature-settings `geo_tagging`? | Per-employee `geotagging`; `geo_tagging_level` parsed but unused **[V]** | SDK `setPolicy` input | M4 |
| P-12 | Which policy governs a crossing: the one at crossing time or at processing time? | Processing time for killed-app crossings **[V]** | RK-14 | M8.9 |
| P-13 | On Android, is "submitted at next app open" acceptable, or is background submission (WorkManager/HeadlessJS) required? | Deferred to next open; last event only **[V]** | RK-02, battery and policy work | M9 |
| P-14 | Should a check-in notification be shown (today only check-out notifies)? | OUT only **[V]** | UX consistency | M4 |
| P-15 | Location tag for queued automatic punches: office (as online) or device fix (as today offline)? | Online: office coordinates; queued: device fix or "lat, lng" string **[V]** | Report consistency, privacy | M5 |
| P-16 | Should device location be captured at all for automatic punches (privacy default)? | Queued rows store device lat/lng/accuracy **[V]** | Data minimization | M4/M8 |
| P-17 | Retention policy for queue rows and the native journal? | Kept indefinitely; no deletion path **[V]** | Privacy (RK-43) | M6/M10 |
| P-18 | Should mock-location events be flagged or blocked? | Not detected **[V]** | Spoofing (RK-31) | M8 (new item) |
| P-19 | Is the in-app copy about force-quit/force-stop correct and acceptable? | iOS copy contradicts Apple staff statements; Android copy is optimistic for ≤ 14 **[V]/[P]** | User trust; support load | M10 |
| P-20 | Accurate purpose strings and removal of the unused motion string? | "drivers during trips"; motion unused **[V]** | App Store review (RK-41) | M7 |

## B. Backend contract unknowns

| ID | Question | Notes |
| --- | --- | --- |
| B-1 | Does `add_offline_employee_checkins` accept an `auto` field (or a source/device marker) so queued automatic punches are not reported as manual? | Queued uploads send no `auto` today **[V]** |
| B-2 | Can either endpoint accept an idempotency key? | Neither does today; duplicates are detected only by timestamp text **[V]** |
| B-3 | Does the backend treat the same punch arriving through both endpoints (online then bulk, different timestamps) as duplicates? | RK-10 |
| B-4 | Server timezone semantics of naive `get_server_time` / `timestamp` values across tenants | Backdating assumes the server's wall clock is the authoritative zone **[V]** |
| B-5 | Exact response shapes of `get_employee_data` across tenant versions (`employee_locations` fields, docname fields) | Code tries several fields **[V]** |
| B-6 | Does `add_log_based_on_employee_field` ever return HTTP 200 without `message.name` on success? | Treated as failure **[V]** |
| B-7 | Full list of validation messages that should be terminal (REJECTED) | Today a narrow regex list **[V]** |
| B-8 | Does `employee_app.gauth.create_refresh_token` accept SDK-issued refresh tokens (mobile sign-in)? | Listed as unverified in `CLAUDE.md`; a refresh failure stops monitoring via logout |
| B-9 | Is `get_attendance_details` paging stable enough for verification (25 pages × 20)? | Verification never proves absence **[V]** |

## C. Platform behaviour to verify on devices

| ID | Question | Source of doubt |
| --- | --- | --- |
| D-1 | Does iOS (current release) relaunch the app for a region event after a user force-quit? | Apple staff: yes (2026); unanswered counter-report on iOS 26.4.2; app copy says no |
| D-2 | Real background time available on iOS after a region wake; does the full JS chain (startup + OTA check + GET + GPS + POST) complete? | Undocumented; archived "≈10 s"; runtime caps at 25 s |
| D-3 | Does `getCurrentPositionAsync({accuracy: Highest})` return during a background wake without the `location` background mode? | Not documented in repo; no timeout in code |
| D-4 | Does Expo Updates `reloadAsync` during a background wake behave correctly (single React root, scene reuse)? | `App.js` checks OTA before mounting the bootstrap |
| D-5 | Effect of Low Power Mode and Background App Refresh on region delivery today | Only inference from archived docs |
| D-6 | Android: are geofences removed when background location permission is revoked? Is the process killed? | Not handled in code |
| D-7 | Android: is `SharedPreferences.apply()` in a receiver durable if the process is killed immediately after `onReceive`? | RK-12 |
| D-8 | Android Auto Backup: does restore bring back `expo_auto_attendance` prefs with `monitoring=true`? | `allowBackup="true"` |
| D-9 | HeadlessJS under RN 0.86 New Architecture from a `WorkManager` worker | Needed for M9 |
| D-10 | Real-world latency and accuracy at the configured production radii (are any < 100 m?) | Platform minimums 100–150 m (Android), 100–500 m (Apple engineer) |
| D-11 | OEM battery managers (Xiaomi, Huawei, Oppo, Vivo, OnePlus, Samsung) — delivery while killed | Detection only today |
| D-12 | iOS initial-state `.unknown` frequency and whether 2/4/8 s retries are sufficient | Code comment only |

## D. Implementation details still unclear

| ID | Question |
| --- | --- |
| I-1 | Is there any intended consumer of `clearProcessedEventMark` (no production caller)? Should logout or scope change clear the high-water mark? |
| I-2 | Should `stopGeofence` failure on Android (store not cleared) be retried? Today the next run calls stop again while inactive. |
| I-3 | Should `ERR_REDUCED_ACCURACY`/registration failures surface to the user? Today `ensureMonitoring` only logs. |
| I-4 | Should the bootstrap subscribe to `onError` (e.g., `GEOFENCE_NOT_AVAILABLE`)? Today only the screen listens. |
| I-5 | Is the `RNFBMessagingDidReceiveRemoteNotification` wake meant to run automatic-attendance replay and presence, or only FCM handling? It does both today. |
| I-6 | Should `hasWorkDue` use the same dependency rule as `claimNextPending` (avoid empty runs)? |
| I-7 | `WARNING_CODES` documents `-2`/`-3`; iOS also emits `-1`, described in a comment as "no code". Which is canonical? |
| I-8 | Expected behaviour when an employee has `restrict_location = 0` and no reporting locations: no monitoring at all? (Today `getOfficeLocation` returns `null` → nothing registered.) |

## E. Missing tests (to add in M0 or with the related milestone)

| ID | Test | Level |
| --- | --- | --- |
| T-1 | Replayed transition queued → NULL tenant → not drained → blocks younger rows → later OUT online before stuck IN | U |
| T-2 | Presence after manual check-out while inside | U |
| T-3 | Office moved while monitoring → no re-registration | U |
| T-4 | Cross-employee replay residue | U |
| T-5 | Policy raised between killed-app crossing and replay | U |
| T-6 | `decideInitialState` and registration flow | XCTest |
| T-7 | Receiver persistence and boot restore | Kotlin JVM/Robolectric |
| T-8 | Uncertain online commit followed by queued duplicate | U + staging |
| T-9 | All device rows in [06 §3](06-TESTING_AND_RISKS.md) | RD |

## F. SDK packaging and governance

| ID | Question |
| --- | --- |
| G-1 | npm scope, package names (`@your-org/…`), licence, repository (monorepo with the app or separate)? |
| G-2 | Supported matrix: Expo-only, or also bare React Native (requires `install-expo-modules`)? Minimum Expo SDK / RN / iOS / Android versions? |
| G-3 | Is the iOS background JS runtime part of the SDK (Expo-specific) or left to hosts? |
| G-4 | Who owns the Frappe adapter and its release cadence relative to `employee_app` backend changes? |
| G-5 | Telemetry: may the SDK report anonymous health metrics, or never (host-only)? |
| G-6 | Versioning policy for native changes (each requires store releases and runtime-version bumps in hosts). |

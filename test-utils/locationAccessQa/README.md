# Disposable simulator backend

This Python standard-library server implements only the app contracts used by isolated simulator tests. Its stored records prove what this **local mock** received and persisted. They do not establish real Frappe/staging timestamp behavior. The scripts are outside the app bundle and add no production authorization bypass.

Start with a new directory for each run; restarting with the same directory retains evidence and records:

```sh
python3 test-utils/locationAccessQa/mock_backend.py --host 127.0.0.1 --port 8765 --data-dir /tmp/claudion-location-qa-backend
```

Android Emulator uses `http://10.0.2.2:8765`; iOS Simulator uses `http://localhost:8765`. Use `--host 0.0.0.0` only if the emulator cannot reach the loopback-bound host. This is a local test service, with synthetic credentials and no production tenant support.

`GET /__qa/fixture?platform=android` or `platform=ios` returns QR provisioning keys, the matching `reduxUser`, a QR payload, a synthetic login fixture, and office/outside coordinates. Employees are `QA-ANDROID-001` and `QA-IOS-001`; `platform=auto` supplies an independent `QA-AUTO-001` for the backend self-test. Seed provisioning only in a new disposable app sandbox or feed the supplied QR through the existing scanner. Authenticate through the actual app's `generateToken`/Login flow. Do not seed an attendance session or server check-in to force a result.

The fixture's `storage` entries correspond to existing QR storage; `reduxUser.userDetails.employeeCode` is required by Login. Provisioning is not an authenticated session. Login submits the fixture's `api_key`, `app_key`, and `api_secret` as form fields to `gauth.generate_token_secure`, receives `{data:{access_token,refresh_token}}`, and writes tokens through the real app's existing token writer.

## Host-side app observation

Start the existing Expo development server on port 8081 and use a locally built native Debug app. `cdp.cjs targets` lists the actual Hermes runtimes. `cdp.cjs eval TARGET snapshot.body.cjs` reads the scoped session, native pending receipts, and SQLite attendance tables without reading credentials. `run.cjs android|ios snapshot LABEL` saves a snapshot and prints a compact summary; its runtime IDs are specific to this disposable run and must be replaced for a new device.

`run.cjs PLATFORM watch` starts a real Expo Location position watch to keep the simulator provider active; `last-fix` reports its measured position; `stop-watch` removes it. `access`, `retry`, and `concurrent-retry` invoke the actual native access/recovery APIs. Calling `access` can itself make the first OS loss observation, so capture persisted state first when testing autonomous callbacks. `navigate 'Auto attendance'` uses the exact existing route name. `locale en|ar` uses normal app localization. These actions refuse non-local tenants and never create an attendance event or session directly.

For iOS filesystem/screenshot collection, set `QA_IOS_UDID` explicitly to the newly created disposable simulator before running `capture-ios.sh LABEL`. The collector is read-only and refuses devices whose names are outside the `Claudion Location Access QA` set, but does not independently authenticate tenant ownership. Never point it at a user's simulator. Do not export AsyncStorage manifests or token databases.

Real OS controls used in the completed run include Android service switches, permission revocation/grants, and an ADB test provider supplying controlled accuracy; iOS `simctl privacy` and the actual Settings Precise Location switch. Remove test providers, restore the shell mock-location app-op, permissions, radios, power mode, language/theme preferences, and backend fault controls after a run. Keep original attendance/journal/queue records for evidence. The [integration report](../../docs/testing/location-access-emulator-2026-10-30/REPORT.md) distinguishes OS execution from deterministic tests and physical/staging limitations.

The default employee has `geotagging: 2`, complete mandatory policy flags, and a 100 m office at latitude `25.2854`, longitude `51.5310`. Tenant `attendance_action.geo_tagging` and offline attendance are real booleans `true`; offline version is `"1"`. Location `{25.29,51.54}` is well outside. This service has no automatic geofence or punch creation: only real online/offline attendance POST handlers can add records.

Inspect `GET /__qa/state` and the data directory's `state.json`, `requests.jsonl`, and `records.jsonl`. Request bodies redact password/token fields. Every accepted record includes the original `time` and `timestamp` unchanged, `receivedAt`, `storedAt`, endpoint, and server docname. Match native IDs against the app's SQLite/session evidence; the backend payload does not carry the native event ID. History returns actual accepted records, scoped to the authorized synthetic employee, newest event timestamp first. Duplicate employee + original timestamp + type reuses the existing record. Offline requests enforce the existing one-log-per-request contract.

Control only synthetic employee policy or failures:

```sh
curl -s http://localhost:8765/__qa/control -H 'Content-Type: application/json' -d '{"employee":"QA-ANDROID-001","network":"drop"}'
curl -s http://localhost:8765/__qa/control -H 'Content-Type: application/json' -d '{"employee":"QA-ANDROID-001","network":"online"}'
curl -s http://localhost:8765/__qa/control -H 'Content-Type: application/json' -d '{"employee":"QA-IOS-001","nextAttendance":{"behavior":"accept_disconnect"}}'
```

`network` supports `online`, `drop` (closes app request sockets), and `503`. QA control/state endpoints remain available. Controls may omit `employee` to affect all disposable profiles. Other controls are `geoTagging` (tenant flag), `geotagging` (employee 0/1/2), `offlineEnabled`, `restrictLocation`, `unrestrictedCheckoutLocation`, `photo`, and complete `geometry:{latitude,longitude,radius}`. Policy changes require the app's ordinary refresh before affecting the running app. Setting `nextAttendance:null` clears an unused fault.

`nextAttendance` affects one actual attendance POST, then clears atomically:

- `accept_disconnect`: stores the submitted event then closes the socket.
- `accept_timeout`: stores the submitted event then delays its response; optional `delaySeconds`, default 20, maximum 120. Choose a delay longer than the actual app request timeout when testing ambiguity.
- `ambiguous`: stores the submitted event and responds without an identifying docname.
- `reject`: returns HTTP 422 and stores no record.

There is deliberately no attendance-record insertion/reset control. Run the following backend-only contract tests before using it:

```sh
python3 -m unittest discover -s test-utils/locationAccessQa -p 'test_*.py' -v
```

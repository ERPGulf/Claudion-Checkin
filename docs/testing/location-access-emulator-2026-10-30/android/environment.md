# Android emulator environment

- Date: 2026-10-30.
- Disposable AVD: `ClaudionLocationQA20261030`, stored under `/private/tmp/claudion-qa-avds`.
- Device serial: `emulator-5560`; Pixel 5 profile, ARM64.
- System image: Android 15 / API 35, Google Play, revision 9.
- Existing user AVDs were preserved; this AVD was created for this test run.
- Local UI automation: Maestro 2.11.0; Android `input` / UIAutomator also available.
- `cmd location` confirms support for `is-location-enabled`, `set-location-enabled`, and test-provider location injection with latitude, longitude, accuracy, and time.
- `cmd power set-mode 1|0` is available for battery-saver tests.
- The debug app manifest already permits cleartext traffic. The isolated local mock tenant will use `http://10.0.2.2:8765`; Metro uses an ADB reverse of port 8081.

This document records environment inspection, not a claim that application scenarios passed.

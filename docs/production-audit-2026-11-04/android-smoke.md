# Disposable Android smoke test — 4 November 2026

Result: the final debug APK installed and rendered unauthenticated Welcome and the empty mobile sign-in form in English and Arabic/RTL on a fresh API 36 ARM64 Google APIs Pixel 7a emulator. Both QR and mobile entry points were visible. Back navigation and language switching worked. No credentials/company/server were entered, no form was submitted, no attendance was filed, and location/tracking was not enabled.

| Evidence | Result |
| --- | --- |
| Final local Android build | `assembleDebug` succeeded in 17 seconds; 598 tasks (35 executed, 563 up-to-date). APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 92,067,374 bytes. This is a debug artifact, not a release build. |
| Emulator | Newly created API 36 ARM64 Google APIs AVD, Pixel 7a, 1080×2400, headless, snapshots disabled, isolated under `/private/tmp/claudion-audit-avd.SfRBvL`. Existing AVDs were not used or altered. |
| Runtime | App process remained alive across English/Arabic navigation. No `FATAL EXCEPTION`, fatal signal, AndroidRuntime crash or ReactNativeJS error was found in the successful launch's process-scoped logs. Two early React Native loading-message diagnostics said the activity was not yet available/active; Welcome and subsequent navigation rendered successfully. |
| English Welcome | [android-welcome.png](evidence/android-welcome.png) |
| English mobile form | [android-mobile-login.png](evidence/android-mobile-login.png) |
| Arabic Welcome | [android-welcome-ar.png](evidence/android-welcome-ar.png) |
| Arabic mobile form | [android-mobile-login-ar.png](evidence/android-mobile-login-ar.png) |

The first launch could not load the development bundle: the existing Metro process listened only on IPv6 `[::1]:8081`, while the emulator's standard development host used IPv4. A temporary proxy bound **only** to IPv4 loopback forwarded to the existing IPv6 Metro listener, after which Android loaded successfully. No application source, firewall rule or host network configuration was changed. Metro's Android development bundle took 8.520 seconds for 2,845 modules; this is a development compilation observation, **not** cold-start or production performance evidence.

Cleanup completed: only this emulator was shut down, both task-created loopback proxy processes were stopped, and the task-created AVD was deleted. The original Metro process was left running for the parent audit's iOS checks. Small local diagnostic logs remain in the task's temporary directory; raw device logs were not copied into the repository.

This smoke test does not validate authenticated QR/mobile flows, live SDK/backend compatibility, foreground/background attendance, process-death/reboot geofencing, offline migrations on a real installed device, push delivery, release signing, physical-device battery consumption or OS background-delivery guarantees. Release and staging gates remain open.

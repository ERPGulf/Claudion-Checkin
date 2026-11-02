# Android capture journal regressions

This JVM harness compiles the production `GeofenceEventJournal.kt` and
`GeofenceStore.kt` and the pure `LocationAccessPolicy.kt`. A filesystem-backed test adapter supplies the small
SharedPreferences API used by the store; JSON-java supplies `org.json` outside
Android. The scheduling adapter verifies each requested delivery already exists
in the durable journal. ApplicationInfo/Log adapters also exercise the production
debug diagnostic journal. No test dependency is added to the application.

With Java and `kotlinc` installed, pass a JSON-java jar to the runner:

```sh
sh modules/expo-auto-attendance/android/journal-tests/run-journal-tests.sh /path/to/json.jar
```

The implementation run used the test-only [JSON-java 20240303 artifact](https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar)
and passed 25 cases before the background sync change. The background sync run
used the cached JSON-java 20180813 artifact and passed 28 cases: both transitions retained, exact acknowledgment, display/stop
retention, initial pending scope, stale callback isolation, immutable capture
scope, replacement fence isolation, one-time legacy migration, sequence persistence, concurrent capture,
corruption refusal, reboot recovery intent, and explicit failed persistence.
The radius cases retain a scoped legacy 100.3 m request alongside Android's
100.30000305175781 m Float, preserve integer geometry and physical IDs, and refuse
to infer requested geometry from an inconsistent scope/configuration fingerprint.

Access cases distinguish confirmed OS revocation from unknown readings; check
strict accuracy-aware inside/outside boundaries; retain the first observed loss
across restart and acknowledgment; reject mismatched recovery IDs/generations;
retain the inside-recovery ENTER barrier until a real EXIT, allow a genuine ENTER after verified outside recovery while disabling registration-repair initial triggers; and prove failed journal
writes cannot advance either loss or recovery state. Control receipts share the
existing sequence but never replace the legacy last-crossing display slot.

Background delivery cases verify every crossing/access receipt requests a wake
after persistence while preserving original IDs/timestamps. Diagnostic cases
exercise 200-record bounds, seven-day expiry, field redaction, UUID-only IDs,
and disabled persistence/readback in release builds. Scheduling/Headless JS are
still Android integration checks, not emulated by these JVM adapters.

The harness does **not** run Android's SharedPreferences implementation, Play
Services, BroadcastReceiver scheduling, permissions, process termination,
reboot, or device power management. An Android application build and the physical
device matrix remain required. API compilation alone also does not establish
receiver delivery or Expo module integration.
The 15-second cancellation, late provider callbacks, Android permission-triggered
process restarts, and fresh-fix behavior require native/device integration tests.

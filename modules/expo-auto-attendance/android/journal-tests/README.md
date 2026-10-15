# Android capture journal regressions

This JVM harness compiles the production `GeofenceEventJournal.kt` and
`GeofenceStore.kt`. A filesystem-backed test adapter supplies the small
SharedPreferences API used by the store; JSON-java supplies `org.json` outside
Android. No test dependency is added to the application.

With Java and `kotlinc` installed, pass a JSON-java jar to the runner:

```sh
sh modules/expo-auto-attendance/android/journal-tests/run-journal-tests.sh /path/to/json.jar
```

The implementation run used the test-only [JSON-java 20240303 artifact](https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar)
and passed 16 cases: both transitions retained, exact acknowledgment, display/stop
retention, initial pending scope, stale callback isolation, immutable capture
scope, replacement fence isolation, one-time legacy migration, sequence persistence, concurrent capture,
corruption refusal, reboot recovery intent, and explicit failed persistence.
The radius cases retain a scoped legacy 100.3 m request alongside Android's
100.30000305175781 m Float, preserve integer geometry and physical IDs, and refuse
to infer requested geometry from an inconsistent scope/configuration fingerprint.

The harness does **not** run Android's SharedPreferences implementation, Play
Services, BroadcastReceiver scheduling, permissions, process termination,
reboot, or device power management. An Android application build and the physical
device matrix remain required. API compilation alone also does not establish
receiver delivery or Expo module integration.

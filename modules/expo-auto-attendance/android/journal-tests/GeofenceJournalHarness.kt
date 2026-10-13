package expo.modules.autoattendance

import android.content.Context
import java.nio.file.Files
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private fun context(): Context = Context(Files.createTempDirectory("attendance-journal-").toFile())

private fun registration(nativeIdentifier: String = "physical-one", employeeId: String = "employee-a") = mapOf(
  "identifier" to "office-main",
  "nativeIdentifier" to nativeIdentifier,
  "tenantKey" to "https://tenant.example.test",
  "employeeId" to employeeId,
  "registrationId" to "configuration-one",
  "geotagging" to 2,
  "latitude" to 10.0,
  "longitude" to 20.0,
  "radius" to 100.0,
)

private fun capture(context: Context, transition: String, nativeIdentifier: String = "physical-one", at: Long = 1000) =
  GeofenceStore.appendEvent(context, transition, at, GeofenceStore.captureMetadata(context, nativeIdentifier))

fun main() {
  var passed = 0
  fun checkCase(name: String, test: () -> Unit) {
    test()
    passed += 1
    println("PASS $name")
  }

  checkCase("ENTER and EXIT survive restart without a JavaScript listener") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val enter = capture(context, "ENTER")
    val exit = capture(context, "EXIT", at = 2000)
    // A new Context reloads the persisted journal, including stable event IDs.
    val pending = GeofenceStore.getPendingEvents(Context(context.directory))
    check(pending.map { it["transition"] } == listOf("ENTER", "EXIT"))
    check(pending.map { it["eventId"] } == listOf(enter["eventId"], exit["eventId"]))
    check(pending.map { (it["sequence"] as Number).toLong() } == listOf(1L, 2L))
  }

  checkCase("acknowledgment consumes only the exact transferred capture") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val enter = capture(context, "ENTER")
    val exit = capture(context, "EXIT")
    check(GeofenceStore.acknowledgeEvent(context, enter["eventId"] as String))
    check(!GeofenceStore.acknowledgeEvent(context, enter["eventId"] as String))
    check(!GeofenceStore.acknowledgeEvent(context, "unknown-id"))
    check(GeofenceStore.getPendingEvents(context).single()["eventId"] == exit["eventId"])
  }

  checkCase("display clearing and monitoring stop preserve all pending captures") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    capture(context, "ENTER")
    capture(context, "EXIT")
    GeofenceStore.clearLastEvent(context)
    GeofenceStore.clearGeofence(context)
    check(GeofenceStore.getLastEvent(context) == null)
    check(!GeofenceStore.isMonitoring(context))
    check(GeofenceStore.getPendingEvents(context).size == 2)
  }

  checkCase("pending registration scopes initial ENTER before registration success") {
    val context = context()
    GeofenceStore.savePendingGeofence(context, registration())
    val enter = capture(context, "ENTER")
    check(enter["tenantKey"] == "https://tenant.example.test")
    check(enter["employeeId"] == "employee-a")
    check(enter["registrationId"] == "configuration-one")
    check(enter["geotagging"] == 2)
    check(enter["captureIssue"] == null)
  }

  checkCase("stale native identifier is retained without current employee attribution") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration("physical-new", "employee-b"))
    val stale = capture(context, "EXIT", nativeIdentifier = "physical-old")
    check(stale["captureIssue"] == "stale-registration")
    check(stale["tenantKey"] == null && stale["employeeId"] == null)
    check(GeofenceStore.getPendingEvents(context).size == 1)
  }

  checkCase("scope snapshot remains the original registration during replacement") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val metadata = GeofenceStore.captureMetadata(context, "physical-one")
    GeofenceStore.clearGeofence(context)
    GeofenceStore.saveGeofence(context, registration("physical-two", "employee-b"))
    val capture = GeofenceStore.appendEvent(context, "EXIT", 1000, metadata)
    check(capture["employeeId"] == "employee-a")
    check(capture["nativeIdentifier"] == "physical-one")
  }

  checkCase("old active fence becomes untrusted once a replacement is pending") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    GeofenceStore.savePendingGeofence(context, registration("physical-two", "employee-b"))
    val stale = capture(context, "EXIT")
    check(stale["employeeId"] == "employee-a")
    check(stale["captureIssue"] == "stale-registration")
    val current = capture(context, "ENTER", nativeIdentifier = "physical-two")
    check(current["employeeId"] == "employee-b")
    check(current["captureIssue"] == null)
  }

  checkCase("legacy last event migrates once and remains unattributed") {
    val context = context()
    val prefs = context.getSharedPreferences("expo_auto_attendance", Context.MODE_PRIVATE)
    check(prefs.edit().putString("last_event", JSONObject(mapOf(
      "transition" to "EXIT", "identifier" to "office-main", "timestamp" to 800L,
    )).toString()).commit())
    val first = GeofenceStore.getPendingEvents(context).single()
    check(first["captureIssue"] == "legacy-unattributed")
    check(first["tenantKey"] == null && first["employeeId"] == null)
    GeofenceStore.clearLastEvent(context)
    check(GeofenceStore.getPendingEvents(context).single()["eventId"] == first["eventId"])
    check(GeofenceStore.acknowledgeEvent(context, first["eventId"] as String))
    check(GeofenceStore.getPendingEvents(context).isEmpty())
  }

  checkCase("sequence stays monotonic after all captures are acknowledged") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val first = capture(context, "ENTER")
    GeofenceStore.acknowledgeEvent(context, first["eventId"] as String)
    val second = capture(context, "EXIT")
    check((second["sequence"] as Number).toLong() == 2L)
  }

  checkCase("rapid concurrent captures are retained without eviction") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val executor = Executors.newFixedThreadPool(4)
    val futures = (0 until 80).map { index -> executor.submit {
      capture(context, if (index % 2 == 0) "ENTER" else "EXIT", at = 1000L + index)
    } }
    futures.forEach { it.get() }
    executor.shutdown()
    check(executor.awaitTermination(10, TimeUnit.SECONDS))
    val events = GeofenceStore.getPendingEvents(context)
    check(events.size == 80)
    check(events.map { it["eventId"] }.toSet().size == 80)
    check(events.map { (it["sequence"] as Number).toLong() } == (1L..80L).toList())
  }

  checkCase("corrupt journal fails explicitly and is never replaced with an empty journal") {
    val context = context()
    val prefs = context.getSharedPreferences("expo_auto_attendance", Context.MODE_PRIVATE)
    check(prefs.edit().putString("event_journal_v1", "corrupt-journal").commit())
    check(runCatching { GeofenceStore.getPendingEvents(context) }.isFailure)
    check(prefs.getString("event_journal_v1", null) == "corrupt-journal")
  }

  checkCase("runtime monitor failure keeps reboot recovery intent until explicit stop") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    GeofenceStore.markMonitoringUnavailable(context)
    check(!GeofenceStore.isMonitoring(context))
    check(GeofenceStore.shouldRestoreGeofence(context))
    check(GeofenceStore.getGeofence(context) != null)
    GeofenceStore.clearGeofence(context)
    check(!GeofenceStore.shouldRestoreGeofence(context))
  }

  checkCase("failed persistence cannot acknowledge or return a newly captured event") {
    var state = GeofenceEventJournal.State(legacyMigrated = true)
    var failWrite = false
    val journal = GeofenceEventJournal(
      readState = { state },
      writeState = { next ->
        check(!failWrite) { "simulated storage failure" }
        state = next
      },
      readLegacyEvent = { null },
    )
    val capture = journal.append(mapOf("transition" to "ENTER"))
    failWrite = true
    check(runCatching { journal.append(mapOf("transition" to "EXIT")) }.isFailure)
    check(runCatching { journal.acknowledge(capture["eventId"] as String) }.isFailure)
    check(state.events.size == 1)
  }

  println("$passed Android journal JVM regression cases passed; Android OS/build behavior was not executed.")
}

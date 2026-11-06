package expo.modules.autoattendance

import android.content.Context
import java.nio.file.Files
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.json.JSONArray
import kotlin.system.exitProcess

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

fun main(args: Array<String>) {
  // Mutate only the parent's disposable fixture, then terminate before any
  // emitter/JS work. The adapter tests process-boundary persistence, not Android
  // receiver scheduling or the real SharedPreferences implementation.
  if (args.size >= 2) {
    val childContext = Context(File(args[1]))
    if (args[0] == "--exit-after-capture") {
      capture(childContext, "ENTER")
      exitProcess(71)
    }
    if (args[0] == "--exit-after-ack" && args.size == 3) {
      GeofenceStore.acknowledgeEvent(childContext, args[2])
      exitProcess(72)
    }
  }
  var passed = 0
  fun checkCase(name: String, test: () -> Unit) {
    test()
    passed += 1
    println("PASS $name")
  }

  fun terminateAfterMutation(context: Context, mode: String, eventId: String? = null): Int {
    val command = mutableListOf(File(System.getProperty("java.home"), "bin/java").path,
      "-cp", System.getProperty("java.class.path"), "expo.modules.autoattendance.GeofenceJournalHarnessKt",
      mode, context.directory.path)
    if (eventId != null) command.add(eventId)
    val child = ProcessBuilder(command).start()
    if (!child.waitFor(30, TimeUnit.SECONDS)) {
      child.destroyForcibly()
      error("Synthetic journal child process did not finish")
    }
    return child.exitValue()
  }

  checkCase("capture survives process termination after commit and before emission") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    check(terminateAfterMutation(context, "--exit-after-capture") == 71)
    val recovered = GeofenceStore.getPendingEvents(Context(context.directory))
    check(recovered.size == 1 && recovered[0]["transition"] == "ENTER")
    check(recovered[0]["employeeId"] == "employee-a")
  }

  checkCase("acknowledgment survives process termination without resurrecting transferred capture") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val original = capture(context, "ENTER")
    check(terminateAfterMutation(context, "--exit-after-ack", original["eventId"] as String) == 72)
    check(GeofenceStore.getPendingEvents(Context(context.directory)).isEmpty())
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

  checkCase("legacy scoped fractional radius retains exact requested geometry across restart and capture") {
    val context = context()
    val requestedRadius = 100.3
    val legacy = registration() + mapOf(
      "radius" to requestedRadius.toFloat().toDouble(),
      "registrationId" to JSONArray(listOf("https://tenant.example.test", "employee-a", "office-main",
        10.0, 20.0, requestedRadius, 2)).toString(),
    )
    GeofenceStore.savePendingGeofence(context, legacy)
    val pending = GeofenceStore.getPendingGeofence(Context(context.directory))!!
    check(pending.getDouble("requestedRadius") == requestedRadius)
    check(pending.getDouble("radius") == requestedRadius.toFloat().toDouble())
    val enter = capture(context, "ENTER")
    check((enter["requestedRadius"] as Number).toDouble() == requestedRadius)
    check((enter["radius"] as Number).toDouble() == requestedRadius.toFloat().toDouble())
    val stored = JSONObject(context.getSharedPreferences("expo_auto_attendance", Context.MODE_PRIVATE)
      .getString("pending_geofence", null)!!)
    check(stored.getDouble("requestedRadius") == requestedRadius)
  }

  checkCase("legacy integer requested radius migration preserves original native identity") {
    val context = context()
    val legacy = registration() + mapOf("registrationId" to JSONArray(listOf(
      "https://tenant.example.test", "employee-a", "office-main", 10.0, 20.0, 100.0, 2,
    )).toString())
    GeofenceStore.saveGeofence(context, legacy)
    val restored = GeofenceStore.getGeofence(context)!!
    check(restored.getDouble("requestedRadius") == 100.0)
    check(restored.getString("nativeIdentifier") == "physical-one")
  }

  checkCase("radius migration refuses geometry or scope inconsistent with its own fingerprint") {
    val context = context()
    val fingerprint = JSONArray(listOf("https://tenant.example.test", "employee-a", "office-main",
      10.0, 20.0, 100.3, 2)).toString()
    listOf(
      mapOf("radius" to 100.4), mapOf("employeeId" to "employee-b"), mapOf("latitude" to 11.0),
      mapOf("tenantKey" to null), mapOf("geotagging" to 1),
    ).forEach { changes ->
      GeofenceStore.saveGeofence(context, registration() + mapOf(
        "radius" to 100.3.toFloat().toDouble(), "registrationId" to fingerprint,
      ) + changes)
      check(!GeofenceStore.getGeofence(context)!!.has("requestedRadius"))
    }
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

  checkCase("OS access is tri-state and never inferred from unknown or GPS failures") {
    check(LocationAccessPolicy.access(true, true, true, true).state == "confirmed_available")
    check(LocationAccessPolicy.access(null, true, true, true).state == "unknown")
    check(LocationAccessPolicy.access(true, null, true, true).state == "unknown")
    check(LocationAccessPolicy.access(false, true, true, true).reason == "services-disabled")
    check(LocationAccessPolicy.access(true, false, false, false).reason == "foreground-permission-lost")
    check(LocationAccessPolicy.access(true, true, false, true).reason == "background-permission-lost")
    check(LocationAccessPolicy.access(true, true, true, false).reason == "precise-permission-lost")
  }

  checkCase("accuracy-aware recovery has strict inside and outside boundaries") {
    check(kotlin.math.abs(LocationAccessPolicy.distance(0.0, 0.0, 0.0, 180.0 / Math.PI * 100.0 / 6371000.0) - 100.0) < 1e-9)
    check(LocationAccessPolicy.distance(91.0, 0.0, 0.0, 0.0).isNaN())
    check(LocationAccessPolicy.presence(80.0, 20.0, 100.0) == "inside")
    check(LocationAccessPolicy.presence(80.1, 20.0, 100.0) == "uncertain")
    check(LocationAccessPolicy.presence(120.0, 20.0, 100.0) == "uncertain")
    check(LocationAccessPolicy.presence(120.1, 20.0, 100.0) == "outside")
    check(LocationAccessPolicy.presence(0.0, 500.0, 100.0) == "uncertain")
    check(LocationAccessPolicy.presence(0.0, -1.0, 100.0) == "uncertain")
    check(LocationAccessPolicy.presence(Double.NaN, 1.0, 100.0) == "uncertain")
  }

  checkCase("first observable access loss is atomic and deduplicated after restart or acknowledgment") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration() + mapOf("registrationGeneration" to "intent-one"))
    val enter = capture(context, "ENTER")
    val lost = GeofenceStore.recordAccessLoss(context, "services-disabled", 3000)!!
    check(lost["kind"] == "LOCATION_ACCESS_LOST" && lost["transition"] == null)
    check(lost["timestamp"] == 3000L && lost["sequence"] == 2L)
    check(GeofenceStore.getLastEvent(context)!!.getString("eventId") == enter["eventId"])
    val restarted = Context(context.directory)
    check(GeofenceStore.recordAccessLoss(restarted, "precise-permission-lost", 9000) == null)
    check(GeofenceStore.acknowledgeEvent(restarted, lost["eventId"] as String))
    check(GeofenceStore.getAccessEpisode(restarted)!!["firstObservedAt"] == 3000)
    check(GeofenceStore.recordAccessLoss(restarted, "services-disabled", 10000) == null)
    check(GeofenceStore.getAccessEpisode(restarted)!!["lossEventId"] == lost["eventId"])
  }

  checkCase("recovery validates original loss and generation and tags repair ENTER until a real EXIT") {
    val context = context()
    val configuration = registration() + mapOf("registrationGeneration" to "intent-one")
    GeofenceStore.saveGeofence(context, configuration)
    val lost = GeofenceStore.recordAccessLoss(context, "services-disabled", 2000)!!
    val lossId = lost["eventId"] as String
    check(GeofenceStore.completeAccessRecovery(context, "other-loss", "intent-one", emptyMap()) == null)
    check(GeofenceStore.completeAccessRecovery(context, lossId, "other-intent", emptyMap()) == null)
    check(capture(context, "ENTER")["lossEventId"] == lossId)
    val recovered = GeofenceStore.completeAccessRecovery(context, lossId, "intent-one", mapOf(
      "timestamp" to 4000L, "fixRequestedAt" to 3500L, "presence" to "inside",
      "position" to mapOf("latitude" to 10.0, "longitude" to 20.0, "horizontalAccuracy" to 5.0, "timestamp" to 4000L)))!!
    check(recovered["kind"] == "LOCATION_ACCESS_RECOVERED")
    check(GeofenceStore.getAccessEpisode(context) == null)
    check(GeofenceStore.completeAccessRecovery(context, lossId, "intent-one", emptyMap()) == null)
    val afterRestart = Context(context.directory)
    check(capture(afterRestart, "ENTER")["lossEventId"] == lossId)
    val persistedProof = GeofenceStore.getPendingEvents(afterRestart).first { it["eventId"] == recovered["eventId"] }
    check(((persistedProof["position"] as Map<*, *>)["horizontalAccuracy"] as Number).toDouble() == 5.0)
    capture(afterRestart, "EXIT")
    check(capture(afterRestart, "ENTER")["lossEventId"] == null)
  }

  checkCase("intentional stop cancels recovery without erasing receipts") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration() + mapOf("registrationGeneration" to "intent-one"))
    val lost = GeofenceStore.recordAccessLoss(context, "services-disabled", 2000)!!
    GeofenceStore.clearGeofence(context)
    check(GeofenceStore.getAccessEpisode(context) == null)
    check(GeofenceStore.getPendingEvents(context).single()["eventId"] == lost["eventId"])
    check(GeofenceStore.recordAccessLoss(context, "services-disabled", 4000) == null)
  }

  checkCase("legacy registration generation is assigned once without rewriting prior receipts") {
    val context = context()
    GeofenceStore.saveGeofence(context, registration())
    val captured = capture(context, "ENTER")
    val generation = captured["registrationGeneration"] as String
    check(generation.isNotBlank())
    val restarted = Context(context.directory)
    check(GeofenceStore.getGeofence(restarted)!!.getString("registrationGeneration") == generation)
    check(GeofenceStore.getPendingEvents(restarted).single()["eventId"] == captured["eventId"])
    check(GeofenceStore.getPendingEvents(restarted).single()["registrationGeneration"] == generation)
  }

  checkCase("same-intent repair retains loss while genuine generation replacement cancels it") {
    val context = context()
    val original = registration() + mapOf("registrationGeneration" to "intent-one")
    GeofenceStore.saveGeofence(context, original)
    val loss = GeofenceStore.recordAccessLoss(context, "services-disabled", 2000)!!
    GeofenceStore.savePendingGeofence(context, original + mapOf("nativeIdentifier" to "physical-repaired"))
    check(GeofenceStore.getAccessEpisode(context)!!["lossEventId"] == loss["eventId"])
    GeofenceStore.savePendingGeofence(context, original + mapOf("registrationGeneration" to "intent-two"))
    check(GeofenceStore.getAccessEpisode(context) == null)
    check(GeofenceStore.getPendingEvents(context).single()["eventId"] == loss["eventId"])
  }

  checkCase("failed loss and recovery writes cannot advance episode state") {
    var state = GeofenceEventJournal.State(legacyMigrated = true)
    var failWrite = true
    val journal = GeofenceEventJournal(readState = { state }, writeState = { next ->
      check(!failWrite) { "simulated disk failure" }; state = next
    }, readLegacyEvent = { null })
    val metadata = registration() + mapOf("registrationGeneration" to "intent-one")
    check(runCatching { journal.recordAccessLoss(metadata, "services-disabled", 2000) }.isFailure)
    check(state.events.isEmpty() && state.accessEpisode == null && state.nextSequence == 0L)
    failWrite = false
    val lost = journal.recordAccessLoss(metadata, "services-disabled", 3000)!!
    failWrite = true
    val proof = mapOf("fixRequestedAt" to 4000L, "timestamp" to 5000L,
      "presence" to "inside", "position" to mapOf("latitude" to 10.0, "longitude" to 20.0,
        "horizontalAccuracy" to 5.0, "timestamp" to 5000L))
    check(runCatching { journal.completeAccessRecovery(lost["eventId"] as String, "intent-one", proof) }.isFailure)
    check(state.events.size == 1 && state.accessEpisode?.get("lossEventId") == lost["eventId"])
  }

  checkCase("verified outside recovery admits a genuine ENTER without repair synthesizing one") {
    val context = context()
    val configuration = registration() + mapOf("registrationGeneration" to "outside-intent")
    GeofenceStore.saveGeofence(context, configuration)
    val lost = GeofenceStore.recordAccessLoss(context, "services-disabled", 2000)!!
    check(GeofenceStore.suppressInitialEnter(context))
    val recovered = GeofenceStore.completeAccessRecovery(context, lost["eventId"] as String, "outside-intent", mapOf(
      "fixRequestedAt" to 3000L, "timestamp" to 4000L, "presence" to "outside",
      "position" to mapOf("latitude" to 10.01, "longitude" to 20.0, "horizontalAccuracy" to 5.0, "timestamp" to 4000L)))!!
    check(recovered["presence"] == "outside")
    val restarted = Context(context.directory)
    check(GeofenceStore.getAccessEpisode(restarted) == null)
    check(GeofenceStore.suppressInitialEnter(restarted))
    GeofenceStore.savePendingGeofence(restarted, configuration + mapOf("nativeIdentifier" to "outside-repair"))
    GeofenceStore.saveGeofence(restarted, configuration + mapOf("nativeIdentifier" to "outside-repair"))
    val entered = capture(restarted, "ENTER", "outside-repair", 5000)
    check(entered["lossEventId"] == null)
    check(GeofenceStore.suppressInitialEnter(restarted))
    capture(restarted, "EXIT", "outside-repair", 6000)
    check(!GeofenceStore.suppressInitialEnter(restarted))
  }

  checkCase("every durable capture requests background delivery after persistence with original identity") {
    val context = context()
    GeofenceCaptureQueue.persisted.clear()
    GeofenceStore.saveGeofence(context, registration() + mapOf("registrationGeneration" to "sync-intent"))
    val enter = capture(context, "ENTER", at = 1000L)
    val exit = capture(context, "EXIT", at = 2000L)
    val loss = GeofenceStore.recordAccessLoss(context, "services-disabled", 3000L)!!
    check(GeofenceStore.recordAccessLoss(context, "services-disabled", 3500L) == null)
    val recovery = GeofenceStore.completeAccessRecovery(context, loss["eventId"] as String, "sync-intent", mapOf(
      "fixRequestedAt" to 4000L, "timestamp" to 5000L, "presence" to "outside"))!!
    check(GeofenceCaptureQueue.persisted.map { it["eventId"] } == listOf(enter, exit, loss, recovery).map { it["eventId"] })
    check(GeofenceCaptureQueue.persisted.map { (it["timestamp"] as Number).toLong() } == listOf(1000L, 2000L, 3000L, 5000L))
  }

  checkCase("background diagnostics are bounded, expire, and redact unknown/private fields") {
    val context = context()
    val stableId = "00000000-1111-2222-3333-444444444444"
    repeat(205) { index -> AttendanceSyncDiagnostics.record(context, "upload.attempt", stableId, mapOf(
      "queueRowId" to index, "httpStatus" to 503, "networkAvailable" to true,
      "password" to "synthetic-secret", "token" to "synthetic-token", "employeeId" to "synthetic-employee",
      "reason" to "https://private.example.test/endpoint")) }
    val rows = AttendanceSyncDiagnostics.entries(Context(context.directory))
    check(rows.size == 200 && rows.first()["queueRowId"] == 5)
    check(rows.all { it["eventId"] == stableId && it["httpStatus"] == 503 && it["networkAvailable"] == true })
    check(rows.all { it.keys == setOf("at", "stage", "eventId", "queueRowId", "httpStatus", "networkAvailable") })
    val stale = JSONObject().put("at", System.currentTimeMillis() - 8L * 24 * 60 * 60 * 1000).put("stage", "stale")
    context.getSharedPreferences("attendance_background_diagnostics", Context.MODE_PRIVATE).edit()
      .putString("entries", JSONArray().put(stale).toString()).commit()
    AttendanceSyncDiagnostics.record(context, "worker.start", "legacy-employee-id")
    val fresh = AttendanceSyncDiagnostics.entries(context)
    check(fresh.size == 1 && fresh.single()["stage"] == "worker.start" && fresh.single()["eventId"] == null)
    check(!context.getSharedPreferences("attendance_background_diagnostics", Context.MODE_PRIVATE)
      .getString("entries", "")!!.contains("stale"))
  }

  checkCase("release builds neither persist nor expose background diagnostics") {
    val context = context()
    val release = Context(context.directory, debuggable = false)
    AttendanceSyncDiagnostics.record(release, "worker.start")
    check(release.getSharedPreferences("attendance_background_diagnostics", Context.MODE_PRIVATE).getString("entries", null) == null)
    AttendanceSyncDiagnostics.record(context, "worker.start")
    check(AttendanceSyncDiagnostics.entries(context).size == 1)
    check(AttendanceSyncDiagnostics.entries(release).isEmpty())
  }

  println("$passed Android journal JVM regression cases passed; Android OS/build behavior was not executed.")
}

package expo.modules.autoattendance

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Shared registration metadata and unacknowledged native transition captures.
 * Attendance submission and session authority remain in the host's SQLite/JS path.
 */
object GeofenceStore {
  private const val PREFS_NAME = "expo_auto_attendance"
  private const val KEY_MONITORING = "monitoring"
  private const val KEY_MONITORING_REQUESTED = "monitoring_requested"
  private const val KEY_GEOFENCE = "geofence"
  private const val KEY_PENDING_GEOFENCE = "pending_geofence"
  private const val KEY_LAST_EVENT = "last_event"
  private const val KEY_EVENT_JOURNAL = "event_journal_v1"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun commit(editor: SharedPreferences.Editor) {
    check(editor.commit()) { "Native geofence storage could not be persisted" }
  }

  private fun bridgeValue(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> asMap(value)
    is JSONArray -> (0 until value.length()).map { bridgeValue(value.get(it)) }
    else -> value
  }

  fun asMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key ->
    bridgeValue(json.get(key))
  }

  private fun storedJson(context: Context, key: String): JSONObject? =
    prefs(context).getString(key, null)?.let { JSONObject(it) }

  private fun storedRegistration(context: Context, key: String): JSONObject? {
    val registration = storedJson(context, key) ?: return null
    if (!registration.has("registrationGeneration")) {
      registration.put("registrationGeneration", UUID.randomUUID().toString())
      commit(prefs(context).edit().putString(key, registration.toString()))
    }
    if (registration.has("requestedRadius")) return registration
    // Prior scoped Android registrations persisted only the rounded OS Float.
    // Recover the original Double from their own immutable fingerprint, never
    // from a current login/configuration, and leave ambiguous geometry alone.
    val requestedRadius = runCatching {
      val fingerprint = JSONArray(registration.getString("registrationId"))
      check(fingerprint.length() == 7)
      val tenant = registration.getString("tenantKey")
      val employee = registration.getString("employeeId")
      val identifier = registration.getString("identifier")
      check(tenant.isNotBlank() && employee.isNotBlank() && identifier.isNotBlank())
      check(fingerprint.get(0) == tenant && fingerprint.get(1) == employee && fingerprint.get(2) == identifier)
      check((fingerprint.get(3) as Number).toDouble() == registration.getDouble("latitude"))
      check((fingerprint.get(4) as Number).toDouble() == registration.getDouble("longitude"))
      check((fingerprint.get(6) as Number).toDouble() == registration.getDouble("geotagging"))
      val requested = (fingerprint.get(5) as Number).toDouble()
      val actual = registration.getDouble("radius")
      check(requested.isFinite() && requested > 0 && actual.isFinite() && actual > 0)
      check(requested.toFloat().toDouble() == actual)
      requested
    }.getOrNull() ?: return registration
    registration.put("requestedRadius", requestedRadius)
    commit(prefs(context).edit().putString(key, registration.toString()))
    return registration
  }

  @Synchronized
  fun savePendingGeofence(context: Context, registration: Map<String, Any?>) {
    val episode = journal(context).captureBarrier()
    if (episode != null && episode["registrationGeneration"] != registration["registrationGeneration"]) {
      journal(context).cancelAccessEpisode()
    }
    commit(prefs(context).edit()
      .putString(KEY_PENDING_GEOFENCE, JSONObject(registration).toString())
      .putBoolean(KEY_MONITORING_REQUESTED, true))
  }

  @Synchronized
  fun saveGeofence(context: Context, registration: Map<String, Any?>) {
    commit(prefs(context).edit()
      .putString(KEY_GEOFENCE, JSONObject(registration).toString())
      .remove(KEY_PENDING_GEOFENCE)
      .putBoolean(KEY_MONITORING_REQUESTED, true)
      .putBoolean(KEY_MONITORING, true))
  }

  @Synchronized
  fun clearPendingGeofence(context: Context, nativeIdentifier: String) {
    if (getPendingGeofence(context)?.optString("nativeIdentifier") == nativeIdentifier) {
      commit(prefs(context).edit().remove(KEY_PENDING_GEOFENCE))
    }
  }

  @Synchronized
  fun clearGeofence(context: Context) {
    journal(context).cancelAccessEpisode()
    // Disable attribution before asynchronous OS removal. Late callbacks remain
    // untrusted evidence instead of inheriting the next authenticated scope.
    commit(prefs(context).edit()
      .remove(KEY_GEOFENCE)
      .remove(KEY_PENDING_GEOFENCE)
      .putBoolean(KEY_MONITORING_REQUESTED, false)
      .putBoolean(KEY_MONITORING, false)
    )
  }

  fun isMonitoring(context: Context): Boolean =
    prefs(context).getBoolean(KEY_MONITORING, false)

  fun shouldRestoreGeofence(context: Context): Boolean =
    prefs(context).getBoolean(KEY_MONITORING_REQUESTED, isMonitoring(context))

  @Synchronized
  fun getGeofence(context: Context): JSONObject? = storedRegistration(context, KEY_GEOFENCE)

  @Synchronized
  fun getPendingGeofence(context: Context): JSONObject? = storedRegistration(context, KEY_PENDING_GEOFENCE)

  @Synchronized
  fun markMonitoringUnavailable(context: Context) {
    commit(prefs(context).edit().putBoolean(KEY_MONITORING, false))
  }

  private fun journal(context: Context): GeofenceEventJournal = GeofenceEventJournal(
    readState = {
      val json = storedJson(context, KEY_EVENT_JOURNAL)
      if (json == null) {
        GeofenceEventJournal.State()
      } else {
        check(json.getInt("version") == 1) { "Unsupported native geofence journal version" }
        val captures = json.getJSONArray("events")
        GeofenceEventJournal.State(
          nextSequence = json.getLong("nextSequence"),
          legacyMigrated = json.getBoolean("legacyMigrated"),
          events = (0 until captures.length()).map { asMap(captures.getJSONObject(it)) },
          accessEpisode = json.optJSONObject("accessEpisode")?.let { asMap(it) },
          recoveryBarrier = json.optJSONObject("recoveryBarrier")?.let { asMap(it) },
        )
      }
    },
    writeState = { state ->
      val events = JSONArray()
      state.events.forEach { events.put(JSONObject(it)) }
      val json = JSONObject()
        .put("version", 1)
        .put("nextSequence", state.nextSequence)
        .put("legacyMigrated", state.legacyMigrated)
        .put("events", events)
        .put("accessEpisode", state.accessEpisode?.let { JSONObject(it) } ?: JSONObject.NULL)
        .put("recoveryBarrier", state.recoveryBarrier?.let { JSONObject(it) } ?: JSONObject.NULL)
      commit(prefs(context).edit().putString(KEY_EVENT_JOURNAL, json.toString()))
    },
    readLegacyEvent = { getLastEvent(context)?.let { asMap(it) } },
  )

  @Synchronized
  fun captureMetadata(context: Context, nativeIdentifier: String): Map<String, Any?> {
    val pending = getPendingGeofence(context)
    val active = if (isMonitoring(context)) getGeofence(context) else null
    val registration = listOfNotNull(pending, active).firstOrNull {
      it.optString("nativeIdentifier") == nativeIdentifier && nativeIdentifier.isNotBlank()
    }
    return registration?.let {
      val metadata = asMap(it)
      val episode = journal(context).captureBarrier()
      val scopedMetadata = if (episode?.get("registrationGeneration") == metadata["registrationGeneration"]) {
        metadata + mapOf("lossEventId" to episode?.get("lossEventId"))
      } else metadata
      if (pending != null && pending.optString("nativeIdentifier") != nativeIdentifier) {
        scopedMetadata + mapOf("captureIssue" to "stale-registration")
      } else scopedMetadata
    } ?: mapOf(
      "identifier" to nativeIdentifier,
      "nativeIdentifier" to nativeIdentifier,
      "tenantKey" to null,
      "employeeId" to null,
      "registrationId" to null,
      "geotagging" to null,
      "captureIssue" to "stale-registration",
    )
  }

  @Synchronized
  fun appendEvent(
    context: Context,
    transition: String,
    timestamp: Long,
    metadata: Map<String, Any?>,
  ): Map<String, Any?> {
    val episode = journal(context).captureBarrier()
    val scopedMetadata = if (episode?.get("registrationGeneration") == metadata["registrationGeneration"]) {
      metadata + mapOf("lossEventId" to episode?.get("lossEventId"))
    } else metadata
    val event = journal(context).append(scopedMetadata + mapOf(
      "transition" to transition,
      "timestamp" to timestamp,
    ))
    // This compatibility display slot does not own delivery. Its failure must
    // not suppress emission after the capture has already been persisted.
    runCatching {
      commit(prefs(context).edit().putString(KEY_LAST_EVENT, JSONObject(event).toString()))
    }
    GeofenceCaptureQueue.onPersisted(context, event)
    return event
  }

  @Synchronized
  fun getPendingEvents(context: Context): List<Map<String, Any?>> = journal(context).pending()

  @Synchronized
  fun acknowledgeEvent(context: Context, eventId: String): Boolean = journal(context).acknowledge(eventId)

  @Synchronized
  fun getAccessEpisode(context: Context): Map<String, Any?>? = journal(context).accessEpisode()

  @Synchronized
  fun suppressInitialEnter(context: Context): Boolean = journal(context).suppressInitialEnter()

  @Synchronized
  fun recordAccessLoss(context: Context, reason: String, at: Long): Map<String, Any?>? {
    if (!shouldRestoreGeofence(context)) return null
    val registration = getPendingGeofence(context) ?: getGeofence(context) ?: return null
    val metadata = asMap(registration)
    if (metadata["tenantKey"] !is String || metadata["employeeId"] !is String ||
      metadata["registrationId"] !is String || metadata["registrationGeneration"] !is String) return null
    return journal(context).recordAccessLoss(metadata, reason, at)?.also {
      GeofenceCaptureQueue.onPersisted(context, it)
    }
  }

  @Synchronized
  fun completeAccessRecovery(context: Context, lossEventId: String, generation: String,
    proof: Map<String, Any?>): Map<String, Any?>? =
    journal(context).completeAccessRecovery(lossEventId, generation, proof)?.also {
      GeofenceCaptureQueue.onPersisted(context, it)
    }

  fun getLastEvent(context: Context): JSONObject? = storedJson(context, KEY_LAST_EVENT)

  @Synchronized
  fun clearLastEvent(context: Context) {
    // Preserve a pre-upgrade capture before clearing presentation history.
    journal(context).pending()
    commit(prefs(context).edit().remove(KEY_LAST_EVENT))
  }
}

package expo.modules.autoattendance

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/** Debug builds only; no tenant, employee, location, request or raw error data. */
object AttendanceSyncDiagnostics {
  private const val PREFS = "attendance_background_diagnostics"
  private const val KEY = "entries"
  private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
  private const val LIMIT = 200
  private val label = Regex("^[a-zA-Z0-9_.:-]{1,80}$")
  private val eventIdPattern = Regex("^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$")
  private val numeric = setOf("queueId", "queueRowId", "sequence", "capturedAt", "timestamp", "occurredAt", "attempt", "httpStatus", "attemptAt", "nextAttemptAt", "durationMs", "count")
  private val boolean = setOf("retryable", "retry", "networkAvailable", "serverReachable")
  private val enums = setOf("status", "transition", "reason", "appState")

  private fun enabled(context: Context): Boolean =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  @Synchronized
  fun record(context: Context, stage: String, eventId: String? = null, details: Map<String, Any?> = emptyMap()) {
    if (!enabled(context) || !label.matches(stage)) return
    // Diagnostic failure must never change attendance capture/delivery behavior.
    runCatching {
      val now = System.currentTimeMillis()
      val entry = JSONObject().put("stage", stage).put("at", now)
      eventId?.takeIf { eventIdPattern.matches(it) }?.let { entry.put("eventId", it) }
      details.forEach { (key, value) ->
        when {
          key in numeric && value is Number && value.toDouble().isFinite() -> entry.put(key, value)
          key in boolean && value is Boolean -> entry.put(key, value)
          key in enums && value is String && label.matches(value) -> entry.put(key, value)
        }
      }
      val previous = read(context, now)
      val next = JSONArray()
      previous.takeLast(LIMIT - 1).forEach { next.put(JSONObject(it)) }
      next.put(entry)
      check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(KEY, next.toString()).commit())
      Log.d(GeofenceManager.TAG, "[attendance-sync] $entry")
    }
  }

  private fun read(context: Context, now: Long): List<Map<String, Any?>> {
    val json = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
    return (0 until json.length()).map { json.getJSONObject(it) }
      .filter { it.optLong("at") in (now - RETENTION_MS)..now }
      .map { GeofenceStore.asMap(it) }
  }

  @Synchronized
  fun entries(context: Context): List<Map<String, Any?>> =
    if (!enabled(context)) emptyList() else runCatching { read(context, System.currentTimeMillis()) }.getOrDefault(emptyList())
}

package expo.modules.autoattendance

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * SharedPreferences-backed persistence for the active geofence configuration and
 * the last received transition event.
 *
 * Persisting the configuration lets [GeofenceBootReceiver] re-register the geofence
 * after a reboot or app update, and lets JS query monitoring state at any time —
 * including events delivered while the React context was not alive.
 */
object GeofenceStore {
  private const val PREFS_NAME = "expo_auto_attendance"
  private const val KEY_MONITORING = "monitoring"
  private const val KEY_GEOFENCE = "geofence"
  private const val KEY_LAST_EVENT = "last_event"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun saveGeofence(
    context: Context,
    identifier: String,
    latitude: Double,
    longitude: Double,
    radius: Float,
  ) {
    val json = JSONObject()
      .put("identifier", identifier)
      .put("latitude", latitude)
      .put("longitude", longitude)
      .put("radius", radius.toDouble())
    prefs(context).edit()
      .putString(KEY_GEOFENCE, json.toString())
      .putBoolean(KEY_MONITORING, true)
      .apply()
  }

  fun clearGeofence(context: Context) {
    prefs(context).edit()
      .remove(KEY_GEOFENCE)
      .putBoolean(KEY_MONITORING, false)
      .apply()
  }

  fun isMonitoring(context: Context): Boolean =
    prefs(context).getBoolean(KEY_MONITORING, false)

  fun getGeofence(context: Context): JSONObject? =
    prefs(context).getString(KEY_GEOFENCE, null)?.let {
      runCatching { JSONObject(it) }.getOrNull()
    }

  fun saveLastEvent(context: Context, transition: String, identifier: String, timestamp: Long) {
    val json = JSONObject()
      .put("transition", transition)
      .put("identifier", identifier)
      .put("timestamp", timestamp)
    prefs(context).edit().putString(KEY_LAST_EVENT, json.toString()).apply()
  }

  fun getLastEvent(context: Context): JSONObject? =
    prefs(context).getString(KEY_LAST_EVENT, null)?.let {
      runCatching { JSONObject(it) }.getOrNull()
    }

  fun clearLastEvent(context: Context) {
    prefs(context).edit().remove(KEY_LAST_EVENT).apply()
  }
}

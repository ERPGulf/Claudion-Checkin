package expo.modules.autoattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * Receives geofence transition broadcasts from the Play Services geofencing engine.
 *
 * Every ENTER / EXIT is logged to Logcat, persisted as the "last event" via
 * [GeofenceStore], and forwarded to JS through [GeofenceEventBus] when the React
 * context is alive.
 *
 * Future integration point: replace the marked blocks below with the automatic
 * check-in (ENTER) / check-out (EXIT) attendance API calls — e.g. by enqueueing a
 * WorkManager job — without touching the rest of the geofencing implementation.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val geofencingEvent = GeofencingEvent.fromIntent(intent)
    if (geofencingEvent == null) {
      Log.w(GeofenceManager.TAG, "Received broadcast without a geofencing event")
      return
    }

    if (geofencingEvent.hasError()) {
      val message = GeofenceStatusCodes.getStatusCodeString(geofencingEvent.errorCode)
      Log.e(GeofenceManager.TAG, "Geofencing error: $message (code=${geofencingEvent.errorCode})")
      GeofenceEventBus.emit(
        ExpoAutoAttendanceModule.EVENT_ERROR,
        mapOf(
          "code" to geofencingEvent.errorCode,
          "message" to message,
        ),
      )
      return
    }

    val transition = geofencingEvent.geofenceTransition
    val eventName = when (transition) {
      Geofence.GEOFENCE_TRANSITION_ENTER -> ExpoAutoAttendanceModule.EVENT_ENTER
      Geofence.GEOFENCE_TRANSITION_EXIT -> ExpoAutoAttendanceModule.EVENT_EXIT
      else -> {
        Log.w(GeofenceManager.TAG, "Ignoring unsupported geofence transition: $transition")
        return
      }
    }

    val transitionLabel =
      if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) "ENTER" else "EXIT"
    val identifiers = geofencingEvent.triggeringGeofences?.map { it.requestId }.orEmpty()
    val identifier = identifiers.firstOrNull() ?: ""
    val timestamp = System.currentTimeMillis()

    Log.i(GeofenceManager.TAG, "$transitionLabel detected: geofence(s)=$identifiers at=$timestamp")

    GeofenceStore.saveLastEvent(context, transitionLabel, identifier, timestamp)

    if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) {
      // Future integration: trigger automatic check-in (attendance API) here.
    } else {
      // Future integration: trigger automatic check-out (attendance API) here.
    }

    GeofenceEventBus.emit(
      eventName,
      mapOf(
        "identifier" to identifier,
        "identifiers" to identifiers,
        "transition" to transitionLabel,
        "timestamp" to timestamp,
      ),
    )
  }
}

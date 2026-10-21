package expo.modules.autoattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Receives geofence transition broadcasts from the Play Services geofencing engine.
 *
 * Every capture is durably appended before delivery. This receiver never submits
 * authenticated attendance or starts another React runtime; the host consumes
 * the journal through its existing SQLite ingress and attendance processor.
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
      if (geofencingEvent.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
        runCatching { GeofenceStore.markMonitoringUnavailable(context) }
      }
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
    val timestamp = System.currentTimeMillis()
    // Snapshot identity on callback receipt, before async persistence can race a
    // logout, opt-out, or replacement registration on the main queue.
    val captures = identifiers.ifEmpty { listOf("") }.map { nativeIdentifier ->
      runCatching { GeofenceStore.captureMetadata(context, nativeIdentifier) }.getOrElse {
        mapOf(
          "identifier" to nativeIdentifier,
          "nativeIdentifier" to nativeIdentifier,
          "captureIssue" to "registration-storage-failed",
        )
      }
    }
    val pendingResult = goAsync()
    val finished = AtomicBoolean(false)
    val timeout = Runnable {
      if (finished.compareAndSet(false, true)) {
        Log.w(GeofenceManager.TAG, "Native transition capture exceeded broadcast budget")
        pendingResult.finish()
      }
    }
    handler.postDelayed(timeout, BROADCAST_BUDGET_MS)
    executor.execute {
      try {
        // Keep even unexpected/stale callback evidence. Missing registration
        // identity is explicit and is never filled from current credentials.
        captures.forEach { metadata ->
          val event = GeofenceStore.appendEvent(context, transitionLabel, timestamp, metadata)
          GeofenceEventBus.emit(eventName, event + mapOf("identifiers" to listOf(event["identifier"])))
        }
      } catch (error: Exception) {
        Log.e(GeofenceManager.TAG, "Native transition capture could not be persisted")
        GeofenceEventBus.emit(
          ExpoAutoAttendanceModule.EVENT_ERROR,
          mapOf("code" to -4, "message" to "Native geofence storage failed"),
        )
      } finally {
        handler.removeCallbacks(timeout)
        if (finished.compareAndSet(false, true)) pendingResult.finish()
      }
    }
  }

  companion object {
    private const val BROADCAST_BUDGET_MS = 8000L
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
  }
}

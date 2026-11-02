package expo.modules.autoattendance

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.UUID

/** Observes authorization, never interprets a poor/no GPS fix as revoked access. */
object LocationAccessMonitor {
  private const val RECOVERY_TIMEOUT_MS = 15000L
  private val handler = Handler(Looper.getMainLooper())
  private data class Attempt(
    val id: String, val lossId: String, val generation: String, val requestedAt: Long,
    val startedElapsed: Long, val cancellation: CancellationTokenSource,
    val timeout: Runnable, val complete: (Map<String, Any?>) -> Unit,
  )
  // All mutation and callbacks run on GeofenceCaptureQueue, including timeouts.
  private var active: Attempt? = null

  private fun readAccess(context: Context): LocationAccessPolicy.Access {
    fun read(operation: () -> Boolean): Boolean? = runCatching(operation).getOrNull()
    val services = read {
      val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ?: error("Location service unavailable")
      LocationManagerCompat.isLocationEnabled(manager)
    }
    val coarse = read { ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED }
    val fine = read { GeofenceManager.hasForegroundLocationPermission(context) }
    val background = read { GeofenceManager.hasBackgroundLocationPermission(context) }
    val foreground = if (fine == true || coarse == true) true else if (fine == false && coarse == false) false else null
    return LocationAccessPolicy.access(services, foreground,
      background, fine)
  }

  private fun snapshot(context: Context, access: LocationAccessPolicy.Access = readAccess(context)): Map<String, Any?> {
    return runCatching {
      val episode = GeofenceStore.getAccessEpisode(context)
      val registration = GeofenceStore.getPendingGeofence(context) ?: GeofenceStore.getGeofence(context)
      mapOf("state" to access.state, "reason" to access.reason,
        "recoveryPending" to (episode != null), "lossEventId" to episode?.get("lossEventId"),
        "registrationGeneration" to (episode?.get("registrationGeneration") ?: registration?.optString("registrationGeneration")),
        "registration" to registration?.let { GeofenceStore.asMap(it) })
    }.getOrElse { mapOf("state" to "unknown", "recoveryPending" to true) }
  }

  // Every public OS observation retains the first confirmed loss, including
  // status checks that happen before a provider broadcast reaches JS.
  fun getState(context: Context): Map<String, Any?> = refresh(context)

  fun refresh(context: Context): Map<String, Any?> = GeofenceCaptureQueue.sync {
    val access = readAccess(context)
    if (access.state != "confirmed_available") cancelAttempt(context)
    if (access.state == "confirmed_disabled") {
      val event = GeofenceStore.recordAccessLoss(context, access.reason!!, System.currentTimeMillis())
      if (event != null) emit(event)
      if (GeofenceStore.getAccessEpisode(context) != null) GeofenceStore.markMonitoringUnavailable(context)
    }
    snapshot(context, access)
  }

  private fun emit(payload: Map<String, Any?>) =
    GeofenceEventBus.emit(ExpoAutoAttendanceModule.EVENT_ACCESS, payload)

  private fun cancelAttempt(context: Context) {
    val request = active ?: return
    active = null
    handler.removeCallbacks(request.timeout)
    request.cancellation.cancel()
    request.complete(snapshot(context))
  }

  fun cancel(context: Context) { GeofenceCaptureQueue.sync { cancelAttempt(context) } }

  @SuppressLint("MissingPermission")
  fun retryRecovery(context: Context, complete: (Map<String, Any?>) -> Unit) {
    GeofenceCaptureQueue.execute {
      try {
        val access = readAccess(context)
        if (access.state != "confirmed_available") {
          if (access.state == "confirmed_disabled") {
            GeofenceStore.recordAccessLoss(context, access.reason!!, System.currentTimeMillis())?.let { emit(it) }
          }
          cancelAttempt(context)
          complete(snapshot(context, access))
          return@execute
        }
        val episode = GeofenceStore.getAccessEpisode(context)
        if (episode == null || active != null) {
          complete(snapshot(context, access))
          return@execute
        }
        val lossId = episode["lossEventId"] as? String
        val generation = episode["registrationGeneration"] as? String
        val lossAt = (episode["firstObservedAt"] as? Number)?.toLong()
        val current = GeofenceStore.getPendingGeofence(context) ?: GeofenceStore.getGeofence(context)
        if (lossId == null || generation == null || current?.optString("registrationGeneration") != generation ||
          !GeofenceStore.shouldRestoreGeofence(context) || lossAt == null || System.currentTimeMillis() < lossAt) {
          complete(snapshot(context, access))
          return@execute
        }
        val attemptId = UUID.randomUUID().toString()
        val timeout = Runnable { GeofenceCaptureQueue.execute {
          if (active?.id == attemptId) cancelAttempt(context)
        } }
        val attempt = Attempt(attemptId, lossId, generation, System.currentTimeMillis(),
          SystemClock.elapsedRealtime(), CancellationTokenSource(), timeout, complete)
        active = attempt
        handler.postDelayed(timeout, RECOVERY_TIMEOUT_MS)
        val request = CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY)
          .setMaxUpdateAgeMillis(0).setDurationMillis(RECOVERY_TIMEOUT_MS).build()
        LocationServices.getFusedLocationProviderClient(context.applicationContext)
          .getCurrentLocation(request, attempt.cancellation.token)
          .addOnSuccessListener { location -> GeofenceCaptureQueue.execute { finish(context, attempt, location) } }
          .addOnFailureListener { GeofenceCaptureQueue.execute {
            if (active?.id == attemptId) cancelAttempt(context)
          } }
          .addOnCanceledListener { GeofenceCaptureQueue.execute {
            if (active?.id == attemptId) cancelAttempt(context)
          } }
      } catch (_: Exception) {
        // Reading access/storage or a failed fresh-fix request is not revocation.
        val pending = active
        if (pending != null) cancelAttempt(context)
        else complete(mapOf("state" to "unknown", "recoveryPending" to true))
      }
    }
  }

  private fun finish(context: Context, request: Attempt, location: Location?) {
    if (active?.id != request.id) return
    try {
      val episode = GeofenceStore.getAccessEpisode(context)
      val registration = GeofenceStore.getPendingGeofence(context) ?: GeofenceStore.getGeofence(context)
      val current = readAccess(context)
      val withinDeadline = SystemClock.elapsedRealtime() - request.startedElapsed < RECOVERY_TIMEOUT_MS
      if (episode?.get("lossEventId") != request.lossId || episode["registrationGeneration"] != request.generation ||
        registration?.optString("registrationGeneration") != request.generation ||
        !GeofenceStore.shouldRestoreGeofence(context) || current.state != "confirmed_available" ||
        !withinDeadline || location == null || location.time < request.requestedAt ||
        location.time > System.currentTimeMillis() || !location.hasAccuracy() ||
        !location.latitude.isFinite() || location.latitude !in -90.0..90.0 ||
        !location.longitude.isFinite() || location.longitude !in -180.0..180.0) return
      val officeLatitude = (episode["latitude"] as? Number)?.toDouble() ?: return
      val officeLongitude = (episode["longitude"] as? Number)?.toDouble() ?: return
      val radius = (episode["radius"] as? Number)?.toDouble() ?: return
      val distance = LocationAccessPolicy.distance(officeLatitude, officeLongitude, location.latitude, location.longitude)
      val presence = LocationAccessPolicy.presence(distance, location.accuracy.toDouble(), radius)
      if (presence == "uncertain") return
      val event = GeofenceStore.completeAccessRecovery(context, request.lossId, request.generation, mapOf(
        "fixRequestedAt" to request.requestedAt, "timestamp" to location.time, "presence" to presence,
        "position" to mapOf("latitude" to location.latitude, "longitude" to location.longitude,
          "horizontalAccuracy" to location.accuracy.toDouble(), "timestamp" to location.time)))
      if (event != null) emit(event)
    } catch (_: Exception) {
      // Keep the episode for retry; errors cannot manufacture a punch.
    } finally {
      if (active?.id == request.id) cancelAttempt(context)
    }
  }
}

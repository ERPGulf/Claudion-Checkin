package expo.modules.autoattendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Wraps the Play Services [GeofencingClient]. All geofence registration and removal
 * goes through this object so that [ExpoAutoAttendanceModule], [GeofenceBootReceiver]
 * and any future background integration share a single implementation.
 *
 * No polling is involved: the OS wakes [GeofenceBroadcastReceiver] via the
 * PendingIntent when the device crosses the registered region boundary.
 */
object GeofenceManager {
  const val TAG = "ExpoAutoAttendance"

  private const val PENDING_INTENT_REQUEST_CODE = 4821
  private val handler = Handler(Looper.getMainLooper())
  private val operationGeneration = AtomicLong(0)
  private val knownIdentifiers = ConcurrentHashMap<String, Long>()
  private val operations = ArrayDeque<(() -> Unit) -> Unit>()
  private var operationRunning = false

  private fun withCurrentGeneration(generation: Long, operation: () -> Unit) {
    synchronized(this) {
      check(generation == operationGeneration.get()) { "Geofence registration was superseded" }
      operation()
    }
  }

  private fun identifiersToRemove(context: Context, maximumGeneration: Long): List<String> {
    val stored = listOfNotNull(GeofenceStore.getGeofence(context), GeofenceStore.getPendingGeofence(context))
      .mapNotNull { registration ->
        registration.optString("nativeIdentifier").takeIf { it.isNotBlank() && it != "null" }
          ?: registration.optString("identifier").takeIf { it.isNotBlank() && it != "null" }
      }
      .filter { (knownIdentifiers[it] ?: Long.MIN_VALUE) <= maximumGeneration }
    return (stored + knownIdentifiers.filterValues { it <= maximumGeneration }.keys).distinct()
  }

  /** Serialize Play Services mutations: a delayed remove must not erase a newer add. */
  private fun enqueueOperation(operation: (() -> Unit) -> Unit) {
    handler.post {
      operations.addLast(operation)
      runNextOperation()
    }
  }

  private fun runNextOperation() {
    if (operationRunning || operations.isEmpty()) return
    operationRunning = true
    var finished = false
    operations.removeFirst().invoke {
      if (!finished) {
        finished = true
        operationRunning = false
        runNextOperation()
      }
    }
  }

  private fun client(context: Context): GeofencingClient =
    LocationServices.getGeofencingClient(context.applicationContext)

  /**
   * Single shared PendingIntent targeting [GeofenceBroadcastReceiver]. Reusing the
   * same request code keeps OS delivery stable. Removal targets physical IDs so
   * a delayed operation cannot erase a newer registration using this intent.
   */
  private fun geofencePendingIntent(context: Context): PendingIntent {
    val intent = Intent(context.applicationContext, GeofenceBroadcastReceiver::class.java)
    // FLAG_MUTABLE is required on Android 12+: the geofencing service appends the
    // triggering geofence data to the intent extras when it fires.
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    return PendingIntent.getBroadcast(
      context.applicationContext,
      PENDING_INTENT_REQUEST_CODE,
      intent,
      flags,
    )
  }

  fun hasForegroundLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED

  fun hasBackgroundLocationPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION,
      ) == PackageManager.PERMISSION_GRANTED

  /**
   * False once the user picks "Approximate" only (Android 12+ location permission
   * dialog) — mirrors iOS's Precise Location toggle. Already enforced indirectly by
   * [hasForegroundLocationPermission] (Approximate-only leaves ACCESS_FINE_LOCATION
   * ungranted), this just exposes the same check under a name matching the iOS API
   * so JS can show the same proactive status regardless of platform.
   */
  fun hasFullAccuracy(context: Context): Boolean = hasForegroundLocationPermission(context)

  private fun powerManager(context: Context): PowerManager? =
    context.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager

  /** Android's Low Power Mode equivalent — can delay or suppress geofence delivery. */
  fun isPowerSaveModeEnabled(context: Context): Boolean =
    powerManager(context)?.isPowerSaveMode == true

  /**
   * False when the OS (or, commonly, OEM battery management on Xiaomi/Huawei/Oppo/
   * Vivo/OnePlus/Samsung) may restrict this app's background execution — the
   * single biggest real-world cause of missed Android geofence events, distinct
   * from Battery Saver mode.
   */
  fun isIgnoringBatteryOptimizations(context: Context): Boolean =
    powerManager(context)?.isIgnoringBatteryOptimizations(context.packageName) == true

  /**
   * Registers a single circular geofence that reports ENTER and EXIT transitions.
   * Callers must verify location permissions first — see the checks in
   * [ExpoAutoAttendanceModule] and [restoreFromStore].
   */
  @SuppressLint("MissingPermission")
  @Synchronized
  fun startMonitoring(
    context: Context,
    identifier: String,
    latitude: Double,
    longitude: Double,
    radius: Double,
    tenantKey: String? = null,
    employeeId: String? = null,
    registrationId: String? = null,
    geotagging: Int? = null,
    onSuccess: () -> Unit,
    onFailure: (Exception) -> Unit,
  ) {
    val generation = operationGeneration.incrementAndGet()
    // The OS ID changes even when the logical office/config ID stays the same.
    // Delayed callbacks for a removed registration must never gain new scope.
    val nativeIdentifier = "attendance:${UUID.randomUUID()}"
    knownIdentifiers[nativeIdentifier] = generation
    val actualRadius = radius.toFloat()
    val registration = mapOf(
      "identifier" to identifier,
      "nativeIdentifier" to nativeIdentifier,
      "latitude" to latitude,
      "longitude" to longitude,
      "radius" to actualRadius.toDouble(),
      "requestedRadius" to radius,
      "tenantKey" to tenantKey,
      "employeeId" to employeeId,
      "registrationId" to registrationId,
      "geotagging" to geotagging,
    )
    enqueueOperation { finish ->
      if (generation != operationGeneration.get()) {
        knownIdentifiers.remove(nativeIdentifier)
        onFailure(IllegalStateException("Geofence registration was superseded"))
        finish()
        return@enqueueOperation
      }
      var settled = false
      lateinit var timeout: Runnable
      fun fail(error: Exception) {
        if (settled) return
        settled = true
        handler.removeCallbacks(timeout)
        runCatching { GeofenceStore.clearPendingGeofence(context, nativeIdentifier) }
        onFailure(error)
        finish()
      }
      timeout = Runnable { fail(IllegalStateException("Geofence registration timed out")) }
      handler.postDelayed(timeout, 20000L)
      try {
        val obsoleteIdentifiers = identifiersToRemove(context, generation - 1)
        // Save scope before Play Services can send an initial ENTER broadcast.
        withCurrentGeneration(generation) { GeofenceStore.savePendingGeofence(context, registration) }
        val geofence = Geofence.Builder()
          .setRequestId(nativeIdentifier)
          .setCircularRegion(latitude, longitude, actualRadius)
          .setExpirationDuration(Geofence.NEVER_EXPIRE)
          .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
          .build()
        val request = GeofencingRequest.Builder()
          .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
          .addGeofence(geofence)
          .build()
        val locationClient = client(context)
        // Target immutable OS IDs. A late removal after timeout cannot remove a
        // newer UUID registration even when it shares this PendingIntent.
        val removal = if (obsoleteIdentifiers.isEmpty()) Tasks.forResult<Void>(null)
          else locationClient.removeGeofences(obsoleteIdentifiers)
        removal
          .addOnSuccessListener {
            obsoleteIdentifiers.forEach { knownIdentifiers.remove(it) }
            if (settled || generation != operationGeneration.get()) {
              fail(IllegalStateException("Geofence registration was superseded"))
            } else {
              try {
                withCurrentGeneration(generation) { GeofenceStore.markMonitoringUnavailable(context) }
              } catch (error: Exception) {
                fail(error)
                return@addOnSuccessListener
              }
              locationClient.addGeofences(request, geofencePendingIntent(context))
                .addOnSuccessListener {
                  if (settled || generation != operationGeneration.get()) {
                    // Target only this obsolete OS ID, including after a timeout.
                    locationClient.removeGeofences(listOf(nativeIdentifier))
                      .addOnCompleteListener {
                        knownIdentifiers.remove(nativeIdentifier)
                        fail(IllegalStateException("Geofence registration was superseded"))
                      }
                  } else {
                    try {
                      withCurrentGeneration(generation) { GeofenceStore.saveGeofence(context, registration) }
                      settled = true
                      handler.removeCallbacks(timeout)
                      Log.i(TAG, "Geofence registered")
                      onSuccess()
                      finish()
                    } catch (error: Exception) {
                      locationClient.removeGeofences(listOf(nativeIdentifier))
                        .addOnCompleteListener {
                          knownIdentifiers.remove(nativeIdentifier)
                          fail(error)
                        }
                    }
                  }
                }
                .addOnFailureListener { fail(it) }
            }
          }
          .addOnFailureListener { fail(it) }
      } catch (error: Exception) {
        fail(error)
      }
    }
  }

  /** Removes known registrations without targeting a later registration's OS ID. */
  @Synchronized
  fun stopMonitoring(
    context: Context,
    onSuccess: () -> Unit,
    onFailure: (Exception) -> Unit,
  ) {
    val generation = operationGeneration.incrementAndGet()
    val identifiers: List<String>
    try {
      identifiers = identifiersToRemove(context, generation)
      GeofenceStore.clearGeofence(context)
    } catch (error: Exception) {
      onFailure(error)
      return
    }
    enqueueOperation { finish ->
      var settled = false
      lateinit var timeout: Runnable
      fun settle(error: Exception? = null) {
        if (settled) return
        settled = true
        handler.removeCallbacks(timeout)
        if (error == null) onSuccess() else onFailure(error)
        finish()
      }
      timeout = Runnable { settle(IllegalStateException("Geofence removal timed out")) }
      handler.postDelayed(timeout, 20000L)
      try {
        val removal = if (identifiers.isEmpty()) Tasks.forResult<Void>(null)
          else client(context).removeGeofences(identifiers)
        removal
          .addOnSuccessListener {
            identifiers.forEach { knownIdentifiers.remove(it) }
            Log.i(TAG, "Monitoring stopped")
            settle()
          }
          .addOnFailureListener { settle(it) }
      } catch (error: Exception) {
        settle(error)
      }
    }
  }

  /**
   * Re-registers the persisted geofence. The OS silently drops geofences on reboot
   * (and historically on app update), so [GeofenceBootReceiver] calls this to keep
   * monitoring alive without user interaction.
   */
  @Synchronized
  fun restoreFromStore(context: Context, onComplete: () -> Unit = {}) {
    if (!GeofenceStore.shouldRestoreGeofence(context)) {
      Log.i(TAG, "No persisted geofence to restore")
      onComplete()
      return
    }
    if (!hasForegroundLocationPermission(context) || !hasBackgroundLocationPermission(context)) {
      Log.w(TAG, "Cannot restore geofence: location permission missing")
      onComplete()
      return
    }
    val stored = GeofenceStore.getPendingGeofence(context) ?: GeofenceStore.getGeofence(context)
    if (stored == null) {
      Log.w(TAG, "Monitoring flag set but no stored geofence found")
      onComplete()
      return
    }
    startMonitoring(
      context,
      identifier = stored.optString("identifier", "office"),
      latitude = stored.optDouble("latitude"),
      longitude = stored.optDouble("longitude"),
      radius = stored.optDouble("requestedRadius", stored.optDouble("radius", 100.0)),
      tenantKey = stored.optString("tenantKey").takeIf { it.isNotBlank() && it != "null" },
      employeeId = stored.optString("employeeId").takeIf { it.isNotBlank() && it != "null" },
      registrationId = stored.optString("registrationId").takeIf { it.isNotBlank() && it != "null" },
      geotagging = if (stored.has("geotagging") && !stored.isNull("geotagging")) {
        stored.optInt("geotagging")
      } else null,
      onSuccess = {
        Log.i(TAG, "Geofence restored after reboot/update")
        onComplete()
      },
      onFailure = { error ->
        Log.e(TAG, "Failed to restore geofence", error)
        onComplete()
      },
    )
  }
}

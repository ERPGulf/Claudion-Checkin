package expo.modules.autoattendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

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

  private fun client(context: Context): GeofencingClient =
    LocationServices.getGeofencingClient(context.applicationContext)

  /**
   * Single shared PendingIntent targeting [GeofenceBroadcastReceiver]. Reusing the
   * same request code lets `removeGeofences(PendingIntent)` drop everything we added.
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
  fun startMonitoring(
    context: Context,
    identifier: String,
    latitude: Double,
    longitude: Double,
    radius: Float,
    onSuccess: () -> Unit,
    onFailure: (Exception) -> Unit,
  ) {
    val geofence = Geofence.Builder()
      .setRequestId(identifier)
      .setCircularRegion(latitude, longitude, radius)
      .setExpirationDuration(Geofence.NEVER_EXPIRE)
      .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
      .build()

    val request = GeofencingRequest.Builder()
      // Fire an ENTER immediately when the device is already inside the region
      // at registration time, so a check-in is never missed.
      .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
      .addGeofence(geofence)
      .build()

    client(context).addGeofences(request, geofencePendingIntent(context))
      .addOnSuccessListener {
        GeofenceStore.saveGeofence(context, identifier, latitude, longitude, radius)
        Log.i(TAG, "Geofence registered: id=$identifier lat=$latitude lng=$longitude radius=${radius}m")
        Log.i(TAG, "Monitoring started")
        onSuccess()
      }
      .addOnFailureListener { error ->
        Log.e(TAG, "Failed to register geofence: ${error.message}", error)
        onFailure(error)
      }
  }

  /** Removes every geofence registered through [geofencePendingIntent]. */
  fun stopMonitoring(
    context: Context,
    onSuccess: () -> Unit,
    onFailure: (Exception) -> Unit,
  ) {
    client(context).removeGeofences(geofencePendingIntent(context))
      .addOnSuccessListener {
        GeofenceStore.clearGeofence(context)
        Log.i(TAG, "Geofence removed")
        Log.i(TAG, "Monitoring stopped")
        onSuccess()
      }
      .addOnFailureListener { error ->
        Log.e(TAG, "Failed to remove geofence: ${error.message}", error)
        onFailure(error)
      }
  }

  /**
   * Re-registers the persisted geofence. The OS silently drops geofences on reboot
   * (and historically on app update), so [GeofenceBootReceiver] calls this to keep
   * monitoring alive without user interaction.
   */
  fun restoreFromStore(context: Context) {
    if (!GeofenceStore.isMonitoring(context)) {
      Log.i(TAG, "No persisted geofence to restore")
      return
    }
    if (!hasForegroundLocationPermission(context) || !hasBackgroundLocationPermission(context)) {
      Log.w(TAG, "Cannot restore geofence: location permission missing")
      return
    }
    val stored = GeofenceStore.getGeofence(context)
    if (stored == null) {
      Log.w(TAG, "Monitoring flag set but no stored geofence found")
      return
    }
    startMonitoring(
      context,
      identifier = stored.optString("identifier", "office"),
      latitude = stored.optDouble("latitude"),
      longitude = stored.optDouble("longitude"),
      radius = stored.optDouble("radius", 100.0).toFloat(),
      onSuccess = { Log.i(TAG, "Geofence restored after reboot/update") },
      onFailure = { error -> Log.e(TAG, "Failed to restore geofence", error) },
    )
  }
}

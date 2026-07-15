package expo.modules.autoattendance

import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Options accepted by `startGeofence` from JS. */
class GeofenceOptions : Record {
  @Field
  val latitude: Double = 0.0

  @Field
  val longitude: Double = 0.0

  /** Radius in meters. */
  @Field
  val radius: Double = 100.0

  @Field
  val identifier: String = "office"
}

/**
 * Expo module exposing native Android geofencing (Play Services GeofencingClient)
 * to JS. Registration/removal is delegated to [GeofenceManager]; transition events
 * arrive via [GeofenceEventBus] from [GeofenceBroadcastReceiver] and are re-emitted
 * to JS as `onGeofenceEnter` / `onGeofenceExit` / `onError`.
 */
class ExpoAutoAttendanceModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoAutoAttendance")

    Events(EVENT_ENTER, EVENT_EXIT, EVENT_ERROR)

    OnCreate {
      GeofenceEventBus.attach { eventName, payload -> sendEvent(eventName, payload) }
    }

    OnDestroy {
      GeofenceEventBus.detach()
    }

    AsyncFunction("startGeofence") { options: GeofenceOptions, promise: Promise ->
      if (options.latitude !in -90.0..90.0 || options.longitude !in -180.0..180.0) {
        promise.reject(
          "ERR_INVALID_OPTIONS",
          "Invalid coordinates: lat=${options.latitude} lng=${options.longitude}",
          null,
        )
        return@AsyncFunction
      }
      if (options.radius <= 0) {
        promise.reject("ERR_INVALID_OPTIONS", "Radius must be a positive number of meters", null)
        return@AsyncFunction
      }
      if (!GeofenceManager.hasForegroundLocationPermission(context)) {
        Log.w(GeofenceManager.TAG, "Permission denied: ACCESS_FINE_LOCATION not granted")
        promise.reject(
          "ERR_LOCATION_PERMISSION",
          "ACCESS_FINE_LOCATION permission is not granted",
          null,
        )
        return@AsyncFunction
      }
      if (!GeofenceManager.hasBackgroundLocationPermission(context)) {
        Log.w(GeofenceManager.TAG, "Permission denied: ACCESS_BACKGROUND_LOCATION not granted")
        promise.reject(
          "ERR_BACKGROUND_LOCATION_PERMISSION",
          "ACCESS_BACKGROUND_LOCATION (\"Allow all the time\") is required on Android 10+",
          null,
        )
        return@AsyncFunction
      }
      Log.i(GeofenceManager.TAG, "Permission granted, registering geofence")

      GeofenceManager.startMonitoring(
        context,
        identifier = options.identifier,
        latitude = options.latitude,
        longitude = options.longitude,
        radius = options.radius.toFloat(),
        onSuccess = { promise.resolve(null) },
        onFailure = { error ->
          promise.reject(
            "ERR_GEOFENCE_REGISTRATION",
            error.message ?: "Failed to register geofence",
            error,
          )
        },
      )
    }

    AsyncFunction("stopGeofence") { promise: Promise ->
      GeofenceManager.stopMonitoring(
        context,
        onSuccess = { promise.resolve(null) },
        onFailure = { error ->
          promise.reject(
            "ERR_GEOFENCE_REMOVAL",
            error.message ?: "Failed to remove geofence",
            error,
          )
        },
      )
    }

    Function("isMonitoring") {
      GeofenceStore.isMonitoring(context)
    }

    Function("getRegisteredGeofences") {
      val stored = GeofenceStore.getGeofence(context)
      if (stored == null || !GeofenceStore.isMonitoring(context)) {
        emptyList()
      } else {
        listOf(
          mapOf(
            "identifier" to stored.optString("identifier"),
            "latitude" to stored.optDouble("latitude"),
            "longitude" to stored.optDouble("longitude"),
            "radius" to stored.optDouble("radius"),
          ),
        )
      }
    }

    Function("getLastEvent") {
      GeofenceStore.getLastEvent(context)?.let {
        mapOf(
          "transition" to it.optString("transition"),
          "identifier" to it.optString("identifier"),
          "timestamp" to it.optLong("timestamp"),
        )
      }
    }

    Function("clearLastEvent") {
      GeofenceStore.clearLastEvent(context)
      Log.i(GeofenceManager.TAG, "Last event cleared")
    }
  }

  companion object {
    const val EVENT_ENTER = "onGeofenceEnter"
    const val EVENT_EXIT = "onGeofenceExit"
    const val EVENT_ERROR = "onError"
  }
}

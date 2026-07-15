import ExpoModulesCore

/// Options accepted by `startGeofence` from JS — mirrors the Android Record.
struct GeofenceOptions: Record {
  @Field
  var latitude: Double = 0

  @Field
  var longitude: Double = 0

  /// Radius in meters (clamped to `maximumRegionMonitoringDistance` on iOS).
  @Field
  var radius: Double = 100

  @Field
  var identifier: String = "office"
}

/**
 Expo module exposing Core Location region monitoring to JS with the exact same
 API and event contract as the Android implementation: `startGeofence`,
 `stopGeofence`, `isMonitoring`, `getRegisteredGeofences`, `getLastEvent`,
 `clearLastEvent`, and the `onGeofenceEnter` / `onGeofenceExit` / `onError` events.
 */
public class ExpoAutoAttendanceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAutoAttendance")

    Events(GeofenceEvents.enter, GeofenceEvents.exit, GeofenceEvents.error)

    OnCreate {
      GeofenceEventBus.shared.listener = { [weak self] eventName, payload in
        self?.sendEvent(eventName, payload)
      }
      DispatchQueue.main.async {
        GeofenceManager.shared.primeOnLaunch()
      }
    }

    OnDestroy {
      GeofenceEventBus.shared.listener = nil
    }

    AsyncFunction("startGeofence") { (options: GeofenceOptions, promise: Promise) in
      if !(-90.0...90.0 ~= options.latitude) || !(-180.0...180.0 ~= options.longitude) {
        promise.reject(
          "ERR_INVALID_OPTIONS",
          "Invalid coordinates: lat=\(options.latitude) lng=\(options.longitude)"
        )
        return
      }
      if options.radius <= 0 {
        promise.reject("ERR_INVALID_OPTIONS", "Radius must be a positive number of meters")
        return
      }
      if !GeofenceManager.shared.hasAnyLocationAuthorization {
        NSLog("%@ Permission denied: location not authorized", GeofenceManager.logTag)
        promise.reject("ERR_LOCATION_PERMISSION", "Location permission is not granted")
        return
      }
      if !GeofenceManager.shared.hasAlwaysAuthorization {
        NSLog("%@ Permission denied: Always authorization not granted", GeofenceManager.logTag)
        promise.reject(
          "ERR_BACKGROUND_LOCATION_PERMISSION",
          "\"Always\" location permission is required for geofencing on iOS"
        )
        return
      }
      NSLog("%@ Permission granted, registering geofence", GeofenceManager.logTag)

      GeofenceManager.shared.start(
        identifier: options.identifier,
        latitude: options.latitude,
        longitude: options.longitude,
        radius: options.radius,
        resolve: { promise.resolve(nil) },
        reject: { code, message in promise.reject(code, message) }
      )
    }.runOnQueue(.main)

    AsyncFunction("stopGeofence") { (promise: Promise) in
      GeofenceManager.shared.stop {
        promise.resolve(nil)
      }
    }.runOnQueue(.main)

    Function("isMonitoring") {
      return GeofenceStore.shared.isMonitoring
    }

    Function("getRegisteredGeofences") { () -> [[String: Any]] in
      guard GeofenceStore.shared.isMonitoring, let stored = GeofenceStore.shared.getGeofence() else {
        return []
      }
      return [stored]
    }

    Function("getLastEvent") { () -> [String: Any]? in
      return GeofenceStore.shared.getLastEvent()
    }

    Function("clearLastEvent") {
      GeofenceStore.shared.clearLastEvent()
      NSLog("%@ Last event cleared", GeofenceManager.logTag)
    }
  }
}

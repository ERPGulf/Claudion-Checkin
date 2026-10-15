import ExpoModulesCore
import Foundation

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

  @Field
  var tenantKey: String?

  @Field
  var employeeId: String?

  @Field
  var registrationId: String?

  @Field
  var geotagging: Int?
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
      if !options.radius.isFinite || options.radius <= 0 {
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
      if !GeofenceManager.shared.hasFullAccuracy {
        NSLog("%@ Reduced accuracy: Precise Location is off", GeofenceManager.logTag)
        promise.reject(
          "ERR_REDUCED_ACCURACY",
          "Precise Location is off for this app. Turn it on in Settings > Privacy & Security > Location Services > Claudion Checkin > Precise Location, then try again."
        )
        return
      }
      NSLog("%@ Permission granted, registering geofence", GeofenceManager.logTag)

      GeofenceManager.shared.start(
        identifier: options.identifier,
        latitude: options.latitude,
        longitude: options.longitude,
        radius: options.radius,
        tenantKey: options.tenantKey,
        employeeId: options.employeeId,
        registrationId: options.registrationId,
        geotagging: options.geotagging,
        resolve: { promise.resolve(nil) },
        reject: { code, message in promise.reject(code, message) }
      )
    }.runOnQueue(.main)

    AsyncFunction("stopGeofence") { (promise: Promise) in
      do {
        try GeofenceManager.shared.stop()
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_NATIVE_STORAGE", "Geofence cancellation could not be persisted")
      }
    }.runOnQueue(.main)

    AsyncFunction("retryInitialPresence") { (promise: Promise) in
      do {
        promise.resolve(try GeofenceManager.shared.retryInitialPresence())
      } catch {
        promise.reject("ERR_NATIVE_STORAGE", "Initial presence recovery could not be persisted")
      }
    }.runOnQueue(.main)

    Function("isMonitoring") { () throws -> Bool in
      return try GeofenceStore.shared.getRegistrationState()?["status"] as? String == "monitoring"
    }

    // Status queries the JS screen can poll (e.g. on focus, before Start) to
    // warn the user proactively instead of only after a rejected startGeofence.
    Function("hasFullAccuracy") {
      return GeofenceManager.shared.hasFullAccuracy
    }

    Function("isLowPowerModeEnabled") {
      return ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    Function("getRegisteredGeofences") { () throws -> [[String: Any]] in
      guard let registration = try GeofenceStore.shared.getRegistrationState(),
        registration["status"] as? String == "monitoring",
        let stored = registration["configuration"] as? [String: Any] else {
        return []
      }
      return [stored]
    }

    Function("getLastEvent") { () -> [String: Any]? in
      return GeofenceStore.shared.getLastEvent()
    }

    Function("getPendingEvents") { () throws -> [[String: Any]] in
      return try GeofenceStore.shared.getPendingEvents()
    }

    Function("acknowledgeEvent") { (eventId: String) throws -> Bool in
      return try GeofenceStore.shared.acknowledgeEvent(eventId)
    }

    Function("clearLastEvent") {
      try GeofenceStore.shared.clearLastEvent()
      NSLog("%@ Last event cleared", GeofenceManager.logTag)
    }
  }
}

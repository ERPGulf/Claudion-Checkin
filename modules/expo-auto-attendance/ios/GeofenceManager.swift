import CoreLocation
import Foundation

/**
 Wraps Core Location region monitoring (`CLLocationManager` + `CLCircularRegion`)
 — the iOS counterpart of the Android `GeofenceManager` (GeofencingClient).

 All registration/removal goes through this singleton so the Expo module, the
 app-delegate subscriber, and any future background integration share one
 implementation. No polling is involved: iOS wakes (or relaunches) the app and
 calls the delegate when the device crosses a monitored region boundary, and it
 keeps monitored regions registered across app restarts on its own — no
 boot-receiver equivalent is needed.

 Must be used from the main thread: `CLLocationManager` needs a run loop, and
 the module runs its functions on the main queue.
 */
final class GeofenceManager: NSObject, CLLocationManagerDelegate {
  static let shared = GeofenceManager()

  static let logTag = "[ExpoAutoAttendance]"

  private lazy var locationManager: CLLocationManager = {
    let manager = CLLocationManager()
    manager.delegate = self
    return manager
  }()

  /// Callbacks for the in-flight `startMonitoring` call — Core Location confirms
  /// registration asynchronously via `didStartMonitoringFor` / `monitoringDidFailFor`.
  private struct PendingStart {
    let identifier: String
    let latitude: Double
    let longitude: Double
    let radius: Double
    let resolve: () -> Void
    let reject: (_ code: String, _ message: String) -> Void
  }

  private var pendingStart: PendingStart?
  private var awaitingInitialState = false

  private override init() {
    super.init()
  }

  /**
   Touches the lazy `CLLocationManager` so the delegate is attached. Called at app
   launch when monitoring is active: when iOS relaunches the app in the background
   for a region crossing, the event is delivered to this delegate (and persisted)
   even though JS has not loaded yet.
   */
  func primeOnLaunch() {
    _ = locationManager
    NSLog("%@ Location manager primed (monitoring=%d)", Self.logTag, GeofenceStore.shared.isMonitoring)
  }

  var hasAnyLocationAuthorization: Bool {
    let status = locationManager.authorizationStatus
    return status == .authorizedAlways || status == .authorizedWhenInUse
  }

  var hasAlwaysAuthorization: Bool {
    return locationManager.authorizationStatus == .authorizedAlways
  }

  /**
   Registers a single circular geofence reporting ENTER and EXIT transitions.
   Any previously registered fence (same or stored identifier) is replaced.
   Callers must verify authorization first — see `ExpoAutoAttendanceModule`.
   */
  func start(
    identifier: String,
    latitude: Double,
    longitude: Double,
    radius: Double,
    resolve: @escaping () -> Void,
    reject: @escaping (_ code: String, _ message: String) -> Void
  ) {
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
      NSLog("%@ Region monitoring is not available on this device", Self.logTag)
      reject("ERR_GEOFENCE_REGISTRATION", "Region monitoring is not available on this device")
      return
    }
    if pendingStart != nil {
      reject("ERR_GEOFENCE_REGISTRATION", "Another geofence registration is already in progress")
      return
    }

    // iOS silently caps the radius at maximumRegionMonitoringDistance; clamp
    // explicitly so the stored value matches what is actually monitored.
    let clampedRadius = min(radius, locationManager.maximumRegionMonitoringDistance)

    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let region = CLCircularRegion(center: center, radius: clampedRadius, identifier: identifier)
    region.notifyOnEntry = true
    region.notifyOnExit = true

    // Replace instead of accumulating regions (iOS allows max 20 per app).
    if let previous = GeofenceStore.shared.getGeofence()?["identifier"] as? String,
      previous != identifier {
      stopMonitoredRegions(withIdentifier: previous)
    }
    stopMonitoredRegions(withIdentifier: identifier)

    pendingStart = PendingStart(
      identifier: identifier,
      latitude: latitude,
      longitude: longitude,
      radius: clampedRadius,
      resolve: resolve,
      reject: reject
    )
    locationManager.startMonitoring(for: region)
  }

  /** Removes the registered geofence and clears the persisted state. */
  func stop(resolve: @escaping () -> Void) {
    let identifier = GeofenceStore.shared.getGeofence()?["identifier"] as? String
    stopMonitoredRegions(withIdentifier: identifier)
    GeofenceStore.shared.clearGeofence()
    NSLog("%@ Geofence removed", Self.logTag)
    NSLog("%@ Monitoring stopped", Self.logTag)
    resolve()
  }

  /**
   Stops monitored circular regions. With an identifier only matching regions are
   stopped; with nil, every circular region is stopped (cleanup path — this module
   is the only registrar of circular regions in this app).
   */
  private func stopMonitoredRegions(withIdentifier identifier: String?) {
    for region in locationManager.monitoredRegions {
      guard region is CLCircularRegion else { continue }
      if identifier == nil || region.identifier == identifier {
        locationManager.stopMonitoring(for: region)
      }
    }
  }

  // MARK: - Transition handling

  /**
   Future integration point: replace the marked blocks with the automatic
   check-in (ENTER) / check-out (EXIT) attendance API calls — e.g. via a
   background URLSession — without touching the rest of the implementation.
   */
  private func handleTransition(_ label: String, eventName: String, region: CLRegion) {
    let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
    NSLog("%@ %@ detected: geofence=%@ at=%lld", Self.logTag, label, region.identifier, timestamp)

    GeofenceStore.shared.saveLastEvent(
      transition: label,
      identifier: region.identifier,
      timestamp: timestamp
    )

    if label == "ENTER" {
      // Future integration: trigger automatic check-in (attendance API) here.
    } else {
      // Future integration: trigger automatic check-out (attendance API) here.
    }

    GeofenceEventBus.shared.emit(eventName, [
      "identifier": region.identifier,
      "identifiers": [region.identifier],
      "transition": label,
      "timestamp": timestamp
    ])
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
    guard let pending = pendingStart, pending.identifier == region.identifier else { return }
    pendingStart = nil

    GeofenceStore.shared.saveGeofence(
      identifier: pending.identifier,
      latitude: pending.latitude,
      longitude: pending.longitude,
      radius: pending.radius
    )
    NSLog(
      "%@ Geofence registered: id=%@ lat=%f lng=%f radius=%.1fm",
      Self.logTag, pending.identifier, pending.latitude, pending.longitude, pending.radius
    )
    NSLog("%@ Monitoring started", Self.logTag)

    // Parity with Android's INITIAL_TRIGGER_ENTER: report ENTER immediately
    // when the device is already inside the region at registration time.
    awaitingInitialState = true
    manager.requestState(for: region)

    pending.resolve()
  }

  func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
    let message = error.localizedDescription
    NSLog("%@ Monitoring failed for %@: %@", Self.logTag, region?.identifier ?? "<unknown>", message)

    if let pending = pendingStart, region == nil || region?.identifier == pending.identifier {
      pendingStart = nil
      pending.reject("ERR_GEOFENCE_REGISTRATION", message)
      return
    }

    GeofenceEventBus.shared.emit(GeofenceEvents.error, [
      "code": (error as NSError).code,
      "message": message
    ])
  }

  func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
    guard awaitingInitialState else { return }
    awaitingInitialState = false
    if state == .inside {
      NSLog("%@ Device already inside region at registration", Self.logTag)
      handleTransition("ENTER", eventName: GeofenceEvents.enter, region: region)
    }
  }

  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    handleTransition("ENTER", eventName: GeofenceEvents.enter, region: region)
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    handleTransition("EXIT", eventName: GeofenceEvents.exit, region: region)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("%@ Location manager error: %@", Self.logTag, error.localizedDescription)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    NSLog("%@ Authorization changed: %d", Self.logTag, status.rawValue)
    if GeofenceStore.shared.isMonitoring && status != .authorizedAlways {
      GeofenceEventBus.shared.emit(GeofenceEvents.error, [
        "code": -1,
        "message": "Location authorization was reduced; geofencing may stop working until \"Always\" access is restored"
      ])
    }
  }
}

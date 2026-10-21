import CoreLocation
import Foundation
import UIKit

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
  private static let regionPrefix = "claudion-auto-attendance:"

  private lazy var locationManager: CLLocationManager = {
    let manager = CLLocationManager()
    manager.delegate = self
    return manager
  }()

  /// Callbacks for the in-flight `startMonitoring` call — Core Location confirms
  /// registration asynchronously via `didStartMonitoringFor` / `monitoringDidFailFor`.
  private struct PendingStart {
    let configuration: [String: Any]
    let region: CLCircularRegion
    let resolve: () -> Void
    let reject: (_ code: String, _ message: String) -> Void

    var nativeIdentifier: String { region.identifier }
  }

  private var pendingStart: PendingStart?

  /// Identifier of the region whose initial state we asked for, or nil when no
  /// request is outstanding. Deliberately not a Bool: `didDetermineState` also
  /// fires for reasons we did not ask about, and a bare flag let any of those
  /// consume the pending request and silently drop the initial check-in.
  private var awaitingInitialStateFor: String?
  private var initialStateAttempts = 0
  private var initialStateGeneration = 0

  /// Core Location commonly answers `.unknown` right after registration, before
  /// it has a usable fix. That is not an answer, so retry a few times with
  /// backoff instead of treating it as "not inside".
  private static let maxInitialStateAttempts = 3

  /// What to do with a reported region state. Pure, so the retry policy can be
  /// reasoned about on its own rather than only observed through Core Location.
  enum InitialStateOutcome: Equatable {
    /// No usable answer yet — ask again after this delay.
    case retry(afterSeconds: Double)
    /// Device is inside the region: report the synthetic ENTER.
    case inside
    /// Final answer, nothing to report.
    case settled
  }

  static func decideInitialState(
    state: CLRegionState,
    attemptsSoFar: Int,
    maxAttempts: Int = maxInitialStateAttempts
  ) -> InitialStateOutcome {
    switch state {
    case .inside:
      return .inside
    case .outside:
      return .settled
    case .unknown:
      guard attemptsSoFar < maxAttempts else { return .settled }
      // 2s, 4s, 8s — long enough for a fix to arrive, short enough that the
      // check-in still lands while the user is walking into the building.
      return .retry(afterSeconds: pow(2.0, Double(attemptsSoFar + 1)))
    @unknown default:
      return .settled
    }
  }

  private func clearInitialStateRequest() {
    initialStateGeneration += 1
    awaitingInitialStateFor = nil
    initialStateAttempts = 0
  }

  private override init() {
    super.init()
    // Low Power Mode throttles Core Location's background accuracy/frequency and
    // can delay or suppress region transitions — there's no way to block it like
    // a permission, so just warn while a geofence is active.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(powerStateDidChange),
      name: .NSProcessInfoPowerStateDidChange,
      object: nil
    )
    NotificationCenter.default.addObserver(self,
      selector: #selector(applicationDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  @objc private func applicationDidBecomeActive() {
    restoreMonitoringIfNeeded()
  }

  private func beginMonitoring(_ pending: PendingStart) {
    pendingStart = pending
    let identifier = pending.nativeIdentifier
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
      guard let self, self.pendingStart?.nativeIdentifier == identifier else { return }
      self.pendingStart = nil
      // Keep scoped ownership durably: a late confirmation/crossing still belongs
      // to this request. JS may cancel it; a future native launch may restore it.
      pending.reject("ERR_GEOFENCE_REGISTRATION", "Geofence registration timed out")
    }
    locationManager.startMonitoring(for: pending.region)
  }

  @objc private func powerStateDidChange() {
    guard GeofenceStore.shared.isMonitoring else { return }
    let enabled = ProcessInfo.processInfo.isLowPowerModeEnabled
    NSLog("%@ Low Power Mode changed: %d", Self.logTag, enabled)
    guard enabled else { return }
    GeofenceEventBus.shared.emit(GeofenceEvents.error, [
      "code": -2,
      "message": "Low Power Mode is on; iOS may delay or suppress automatic check-in/out until it's turned off."
    ])
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
    restoreMonitoringIfNeeded()
  }

  /// Core Location normally retains regions. Repair missing registrations from
  /// their saved scope/geometry without obtaining GPS or inventing a transition.
  private func restoreMonitoringIfNeeded() {
    guard pendingStart == nil else { return }
    do {
      let saved = try GeofenceStore.shared.getRegistrationState()
      guard let registration = saved,
        ["pending", "monitoring"].contains(registration["status"] as? String ?? "") else {
        // A durable stop may have preceded process death and the OS removal.
        stopMonitoredRegions(configuration: saved?["configuration"] as? [String: Any])
        return
      }
      guard hasAlwaysAuthorization, hasFullAccuracy else { return }
      guard var configuration = registration["configuration"] as? [String: Any],
        let identifier = configuration["nativeIdentifier"] as? String ?? configuration["identifier"] as? String,
        let latitude = configuration["latitude"] as? Double,
        let longitude = configuration["longitude"] as? Double,
        let radius = configuration["radius"] as? Double,
        CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: latitude, longitude: longitude)),
        radius.isFinite, radius > 0 else { return }
      if locationManager.monitoredRegions.contains(where: { $0.identifier == identifier }) {
        if registration["status"] as? String == "pending" {
          try GeofenceStore.shared.confirmRegistration(identifier)
        }
        _ = try retryInitialPresence()
        return
      }
      // Restore the exact source identity. Creating a new ID here would orphan
      // callbacks delivered for the registration interrupted by process death.
      configuration["nativeIdentifier"] = identifier
      try GeofenceStore.shared.savePendingRegistration(configuration)
      let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        radius: radius, identifier: identifier)
      region.notifyOnEntry = true
      region.notifyOnExit = true
      clearInitialStateRequest()
      stopMonitoredRegions()
      beginMonitoring(PendingStart(configuration: configuration, region: region,
        resolve: {}, reject: { _, _ in
          GeofenceEventBus.shared.emit(GeofenceEvents.error, [
            "code": -5, "message": "Geofence restoration failed"
          ])
        }))
    } catch {
      reportStorageFailure()
    }
  }

  /// Retry only an unfinished native observation, at most one bounded cycle per
  /// persisted cooldown. Reuse/resume of completed presence cannot create IN.
  @discardableResult
  func retryInitialPresence(for confirmedRegion: CLRegion? = nil) throws -> Bool {
    guard awaitingInitialStateFor == nil, pendingStart == nil,
      hasAlwaysAuthorization, hasFullAccuracy,
      let registration = try GeofenceStore.shared.getRegistrationState(),
      registration["status"] as? String == "monitoring",
      let configuration = registration["configuration"] as? [String: Any],
      let identifier = configuration["nativeIdentifier"] as? String ?? configuration["identifier"] as? String,
      let region = confirmedRegion ?? locationManager.monitoredRegions.first(where: { $0.identifier == identifier }),
      region.identifier == identifier,
      try GeofenceStore.shared.beginInitialPresenceRequest(identifier, at: Int64(Date().timeIntervalSince1970 * 1000)) else { return false }
    awaitingInitialStateFor = identifier
    initialStateAttempts = 0
    let generation = initialStateGeneration
    // A missing callback cannot keep recovery permanently in-flight. The OS
    // still controls execution; a suspended timer resumes or launch retries later.
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
      guard let self, self.initialStateGeneration == generation,
        self.awaitingInitialStateFor == identifier else { return }
      self.clearInitialStateRequest()
    }
    locationManager.requestState(for: region)
    return true
  }

  private func reportStorageFailure() {
    NSLog("%@ Native geofence storage failed", Self.logTag)
    GeofenceEventBus.shared.emit(GeofenceEvents.error, [
      "code": -4, "message": "Native geofence state could not be persisted"
    ])
  }

  var hasAnyLocationAuthorization: Bool {
    let status = locationManager.authorizationStatus
    return status == .authorizedAlways || status == .authorizedWhenInUse
  }

  var hasAlwaysAuthorization: Bool {
    return locationManager.authorizationStatus == .authorizedAlways
  }

  /// False when the user picked "Precise: Off" for this app — a geofence radius
  /// as small as 100 m is unreliable under reduced (city-block level) accuracy.
  var hasFullAccuracy: Bool {
    return locationManager.accuracyAuthorization == .fullAccuracy
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
    tenantKey: String? = nil,
    employeeId: String? = nil,
    registrationId: String? = nil,
    geotagging: Int? = nil,
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
    let maximumRadius = locationManager.maximumRegionMonitoringDistance
    let clampedRadius = maximumRadius > 0 ? min(radius, maximumRadius) : radius

    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    // A distinct OS identifier per registration rejects callbacks/retries from
    // an earlier employee, geometry or opt-in generation with the same logical ID.
    let nativeIdentifier = "\(Self.regionPrefix)\(identifier):\(UUID().uuidString)"
    let region = CLCircularRegion(center: center, radius: clampedRadius, identifier: nativeIdentifier)
    region.notifyOnEntry = true
    region.notifyOnExit = true

    var configuration: [String: Any] = [
      "identifier": identifier, "nativeIdentifier": nativeIdentifier,
      "latitude": latitude, "longitude": longitude,
      "radius": clampedRadius, "requestedRadius": radius,
      "registrationStartedAt": Int64(Date().timeIntervalSince1970 * 1000)
    ]
    configuration["tenantKey"] = tenantKey
    configuration["employeeId"] = employeeId
    configuration["registrationId"] = registrationId
    configuration["geotagging"] = geotagging

    let previousConfiguration: [String: Any]?
    do {
      previousConfiguration = try GeofenceStore.shared.getRegistrationState()?["configuration"] as? [String: Any]
      // Ownership must reach stable storage before the OS can deliver a callback.
      try GeofenceStore.shared.savePendingRegistration(configuration)
    } catch {
      reject("ERR_NATIVE_STORAGE", "Geofence registration could not be persisted")
      return
    }
    clearInitialStateRequest()
    // Replace instead of accumulating regions (iOS allows max 20 per app).
    stopMonitoredRegions(configuration: previousConfiguration)

    beginMonitoring(PendingStart(
      configuration: configuration,
      region: region,
      resolve: resolve,
      reject: reject
    ))
  }

  /** Removes the registered geofence and clears the persisted state. */
  func stop() throws {
    let previousConfiguration = try GeofenceStore.shared.getRegistrationState()?["configuration"] as? [String: Any]
    // Durable cancellation wins against a process death or late OS confirmation.
    try GeofenceStore.shared.cancelRegistration()
    // Cancel any outstanding initial-state retry: monitoring is going away, so a
    // late `.inside` must not produce a check-in after the user opted out.
    clearInitialStateRequest()
    let pending = pendingStart
    pendingStart = nil
    if let pending { locationManager.stopMonitoring(for: pending.region) }
    stopMonitoredRegions(configuration: previousConfiguration)
    pending?.reject("ERR_GEOFENCE_CANCELLED", "Geofence registration was cancelled")
    NSLog("%@ Geofence removed", Self.logTag)
    NSLog("%@ Monitoring stopped", Self.logTag)
  }

  /// Remove this module's current/obsolete registrations, including legacy IDs.
  private func stopMonitoredRegions(configuration: [String: Any]? = nil) {
    let stored = configuration ?? GeofenceStore.shared.getGeofence()
    let logicalIdentifier = stored?["identifier"] as? String
    let nativeIdentifier = stored?["nativeIdentifier"] as? String
    for region in locationManager.monitoredRegions {
      guard region is CLCircularRegion else { continue }
      if region.identifier.hasPrefix(Self.regionPrefix) || region.identifier == logicalIdentifier ||
        region.identifier == nativeIdentifier || region.identifier == "office-main" || region.identifier == "office" {
        locationManager.stopMonitoring(for: region)
      }
    }
  }

  // MARK: - Transition handling

  /// Capture first. Authentication, attendance decisions and retries stay in the
  /// existing JS session authority and SQLite attendance infrastructure.
  private func handleTransition(_ label: String, eventName: String, region: CLRegion, initialPresence: Bool = false) {
    let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
    NSLog("%@ %@ detected: geofence=%@ at=%lld", Self.logTag, label, region.identifier, timestamp)

    do {
      var configuration: [String: Any]?
      if let registration = try GeofenceStore.shared.getRegistrationState(),
        ["pending", "monitoring"].contains(registration["status"] as? String ?? ""),
        let stored = registration["configuration"] as? [String: Any],
        (stored["nativeIdentifier"] as? String ?? stored["identifier"] as? String) == region.identifier {
        configuration = stored
      }
      var event: [String: Any] = configuration ?? [:]
      var logicalIdentifier = configuration?["identifier"] as? String ?? region.identifier
      if configuration == nil, region.identifier.hasPrefix(Self.regionPrefix) {
        logicalIdentifier = String(region.identifier.dropFirst(Self.regionPrefix.count))
          .split(separator: ":").dropLast().joined(separator: ":")
      }
      event["identifier"] = logicalIdentifier
      event["nativeIdentifier"] = region.identifier
      event["identifiers"] = [logicalIdentifier]
      event["transition"] = label
      event["timestamp"] = timestamp
      if initialPresence { event["initialPresence"] = true }
      if configuration == nil {
        // Preserve obsolete callbacks for review; assigning the current employee
        // would cross an identity boundary. No attendance is authorized by this.
        event["captureIssue"] = region.identifier.hasPrefix(Self.regionPrefix)
          ? "stale-registration" : "unknown-registration"
        if let circular = region as? CLCircularRegion {
          event["latitude"] = circular.center.latitude
          event["longitude"] = circular.center.longitude
          event["radius"] = circular.radius
        }
      }
      // A genuine transition proves that the registration already observed
      // presence. Finish in the append transaction, preventing a later initial
      // ENTER from reopening a manual checkout after this event is replayed.
      let saved = try GeofenceStore.shared.appendEvent(event,
        completingInitialPresenceFor: configuration == nil ? nil : region.identifier)
      if configuration != nil, awaitingInitialStateFor == region.identifier { clearInitialStateRequest() }
      GeofenceEventBus.shared.emit(eventName, saved.mapValues { Optional($0) })
    } catch {
      reportStorageFailure()
    }
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
    let pending = pendingStart?.nativeIdentifier == region.identifier ? pendingStart : nil
    do {
      guard try GeofenceStore.shared.confirmRegistration(region.identifier) else {
        // Durable cancellation/replacement wins even after a process restart.
        if region.identifier.hasPrefix(Self.regionPrefix) || region.identifier == "office-main" || region.identifier == "office" {
          manager.stopMonitoring(for: region)
        }
        return
      }
      if pending != nil { pendingStart = nil }
      NSLog("%@ Geofence registered", Self.logTag)
      NSLog("%@ Monitoring started", Self.logTag)
      _ = try retryInitialPresence(for: region)
      pending?.resolve()
    } catch {
      if pending != nil { pendingStart = nil }
      pending?.reject("ERR_NATIVE_STORAGE", "Geofence registration could not be persisted")
      reportStorageFailure()
    }
  }

  func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
    let message = error.localizedDescription
    NSLog("%@ Monitoring failed for %@: %@", Self.logTag, region?.identifier ?? "<unknown>", message)

    do {
      if try GeofenceStore.shared.invalidateRegistration(region?.identifier) { clearInitialStateRequest() }
      if let pending = pendingStart, region == nil || region?.identifier == pending.nativeIdentifier {
        pendingStart = nil
        pending.reject("ERR_GEOFENCE_REGISTRATION", message)
        return
      }
    } catch {
      reportStorageFailure()
    }

    GeofenceEventBus.shared.emit(GeofenceEvents.error, [
      "code": (error as NSError).code,
      "message": message
    ])
  }

  func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
    // Only act on the request we made, for the region we made it for.
    guard awaitingInitialStateFor == region.identifier else { return }

    switch Self.decideInitialState(state: state, attemptsSoFar: initialStateAttempts) {
    case .retry(let afterSeconds):
      initialStateAttempts += 1
      NSLog(
        "%@ Initial state unknown for %@; retrying in %.0fs (attempt %d/%d)",
        Self.logTag, region.identifier, afterSeconds,
        initialStateAttempts, Self.maxInitialStateAttempts
      )
      let generation = initialStateGeneration
      DispatchQueue.main.asyncAfter(deadline: .now() + afterSeconds) { [weak self] in
        // Monitoring may have been stopped or replaced in the meantime.
        guard let self, self.initialStateGeneration == generation,
          self.awaitingInitialStateFor == region.identifier else { return }
        self.locationManager.requestState(for: region)
      }

    case .inside:
      clearInitialStateRequest()
      NSLog("%@ Device already inside region at registration", Self.logTag)
      handleTransition("ENTER", eventName: GeofenceEvents.enter, region: region, initialPresence: true)

    case .settled:
      let gaveUp = state == .unknown
      if state == .outside {
        do { try GeofenceStore.shared.completeInitialPresence(region.identifier) }
        catch { reportStorageFailure() }
      }
      // Unknown exhaustion stays unfinished durably; resume/reconciliation may
      // begin another bounded authoritative cycle after its cooldown.
      clearInitialStateRequest()
      NSLog(
        "%@ Initial state for %@ settled as %@",
        Self.logTag, region.identifier,
        gaveUp ? "unknown (no transition manufactured)" : "outside"
      )
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
    do {
      guard let registration = try GeofenceStore.shared.getRegistrationState(),
        ["pending", "monitoring"].contains(registration["status"] as? String ?? "") else { return }
    } catch {
      reportStorageFailure()
      return
    }
    if status != .authorizedAlways {
      GeofenceEventBus.shared.emit(GeofenceEvents.error, [
        "code": -1,
        "message": "Location authorization was reduced; geofencing may stop working until \"Always\" access is restored"
      ])
    } else if manager.accuracyAuthorization != .fullAccuracy {
      GeofenceEventBus.shared.emit(GeofenceEvents.error, [
        "code": -3,
        "message": "Precise Location was turned off; automatic check-in/out may be unreliable until it's turned back on for this app."
      ])
    } else {
      restoreMonitoringIfNeeded()
    }
  }
}

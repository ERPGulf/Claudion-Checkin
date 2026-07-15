import Foundation

/**
 UserDefaults-backed persistence for the active geofence configuration and the
 last received transition event — the iOS counterpart of the Android
 `GeofenceStore` (SharedPreferences).

 Persisting the last event lets JS read transitions that were delivered while the
 app was relaunched in the background by Core Location (no React context alive).
 */
final class GeofenceStore {
  static let shared = GeofenceStore()

  private let monitoringKey = "expoAutoAttendance.monitoring"
  private let geofenceKey = "expoAutoAttendance.geofence"
  private let lastEventKey = "expoAutoAttendance.lastEvent"

  private let defaults = UserDefaults.standard

  private init() {}

  var isMonitoring: Bool {
    return defaults.bool(forKey: monitoringKey)
  }

  func saveGeofence(identifier: String, latitude: Double, longitude: Double, radius: Double) {
    let geofence: [String: Any] = [
      "identifier": identifier,
      "latitude": latitude,
      "longitude": longitude,
      "radius": radius
    ]
    defaults.set(geofence, forKey: geofenceKey)
    defaults.set(true, forKey: monitoringKey)
  }

  func clearGeofence() {
    defaults.removeObject(forKey: geofenceKey)
    defaults.set(false, forKey: monitoringKey)
  }

  func getGeofence() -> [String: Any]? {
    return defaults.dictionary(forKey: geofenceKey)
  }

  func saveLastEvent(transition: String, identifier: String, timestamp: Int64) {
    let event: [String: Any] = [
      "transition": transition,
      "identifier": identifier,
      "timestamp": timestamp
    ]
    defaults.set(event, forKey: lastEventKey)
  }

  func getLastEvent() -> [String: Any]? {
    return defaults.dictionary(forKey: lastEventKey)
  }

  func clearLastEvent() {
    defaults.removeObject(forKey: lastEventKey)
  }
}

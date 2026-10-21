import Foundation

/// Event names shared between the manager and the Expo module definition.
enum GeofenceEvents {
  static let enter = "onGeofenceEnter"
  static let exit = "onGeofenceExit"
  static let error = "onError"
}

/**
 In-process bridge between `GeofenceManager` (whose Core Location delegate can
 fire while no JS is loaded, e.g. after a background relaunch) and
 `ExpoAutoAttendanceModule`, which forwards events to JS listeners.

 Events are appended to `GeofenceStore` before being emitted. The pending journal
 remains until JS transfers the exact event ID to the existing SQLite database.
 */
final class GeofenceEventBus {
  static let shared = GeofenceEventBus()

  var listener: ((_ eventName: String, _ payload: [String: Any?]) -> Void)?

  private init() {}

  func emit(_ eventName: String, _ payload: [String: Any?]) {
    if eventName == GeofenceEvents.enter || eventName == GeofenceEvents.exit {
      // Persistence happens before emit. A scene-less native wake must start
      // the app's existing JS replay/submission path, even with no listener yet.
      NotificationCenter.default.post(name: Notification.Name("ClaudionGeofenceTransition"), object: nil)
    }
    listener?(eventName, payload)
  }
}

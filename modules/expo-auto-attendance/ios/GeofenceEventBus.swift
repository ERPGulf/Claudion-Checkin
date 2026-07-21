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

 Events are persisted via `GeofenceStore` before being emitted, so nothing is
 lost when no listener is attached — mirroring the Android `GeofenceEventBus`.
 */
final class GeofenceEventBus {
  static let shared = GeofenceEventBus()

  var listener: ((_ eventName: String, _ payload: [String: Any?]) -> Void)?

  private init() {}

  func emit(_ eventName: String, _ payload: [String: Any?]) {
    listener?(eventName, payload)
  }
}

import Foundation

/// Coordinate quality is independent of OS authorization. Uncertain fixes
/// never establish an exit, revoke access, or complete an interruption episode.
enum LocationAccessGeometry {
  static func classify(position: [String: Any], office: [String: Any], requestedAt: Int64,
    firstObservedAt: Int64, observedAt: Int64) -> String? {
    guard let latitude = (position["latitude"] as? NSNumber)?.doubleValue,
      let longitude = (position["longitude"] as? NSNumber)?.doubleValue,
      let accuracy = (position["horizontalAccuracy"] as? NSNumber)?.doubleValue,
      let timestamp = position["timestamp"] as? NSNumber,
      let officeLatitude = (office["latitude"] as? NSNumber)?.doubleValue,
      let officeLongitude = (office["longitude"] as? NSNumber)?.doubleValue,
      let radius = (office["radius"] as? NSNumber)?.doubleValue,
      [latitude, longitude, officeLatitude, officeLongitude, accuracy, radius].allSatisfy({ $0.isFinite }),
      abs(latitude) <= 90, abs(longitude) <= 180, abs(officeLatitude) <= 90, abs(officeLongitude) <= 180,
      accuracy >= 0, radius > 0, requestedAt >= firstObservedAt,
      timestamp.int64Value >= requestedAt, timestamp.int64Value <= observedAt else { return nil }
    let radians = Double.pi / 180
    let deltaLatitude = (latitude - officeLatitude) * radians
    let deltaLongitude = (longitude - officeLongitude) * radians
    let a = pow(sin(deltaLatitude / 2), 2) + cos(latitude * radians) * cos(officeLatitude * radians) *
      pow(sin(deltaLongitude / 2), 2)
    let distance = 6_371_000 * 2 * atan2(sqrt(max(0, min(1, a))), sqrt(max(0, 1 - a)))
    return classify(distance: distance, accuracy: accuracy, radius: radius)
  }

  static func classify(distance: Double, accuracy: Double, radius: Double) -> String? {
    guard distance.isFinite, accuracy.isFinite, radius.isFinite,
      distance >= 0, accuracy >= 0, radius > 0 else { return nil }
    if distance + accuracy <= radius { return "inside" }
    if distance - accuracy > radius { return "outside" }
    return nil
  }
}

/// Main-thread recovery ownership. Nothing in-flight is persisted: after a
/// process restart the OS request is gone while the journal episode survives.
final class LocationAccessAttemptGate {
  struct Attempt {
    let id: String
    let lossEventId: String
    let registrationGeneration: String
    let requestedAt: Int64
    let deadlineUptime: TimeInterval

    func isWithinDeadline(at uptime: TimeInterval) -> Bool { uptime < deadlineUptime }
  }

  private(set) var current: Attempt?

  func begin(lossEventId: String, registrationGeneration: String, requestedAt: Int64,
    uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Attempt? {
    guard current == nil else { return nil }
    let attempt = Attempt(id: UUID().uuidString, lossEventId: lossEventId,
      registrationGeneration: registrationGeneration, requestedAt: requestedAt, deadlineUptime: uptime + 15)
    current = attempt
    return attempt
  }

  @discardableResult
  func finish(_ attemptId: String) -> Attempt? {
    guard let attempt = current, attempt.id == attemptId else { return nil }
    current = nil
    return attempt
  }
}

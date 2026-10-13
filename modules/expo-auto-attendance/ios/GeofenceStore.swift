import Foundation

/// Registration/display compatibility stays in UserDefaults. The pending native
/// ingress journal is an atomic file: it contains transitions, not attendance
/// decisions, and JS acknowledges an ID only after transferring it to SQLite.
final class GeofenceStore {
  static let shared = GeofenceStore()

  private let monitoringKey = "expoAutoAttendance.monitoring"
  private let geofenceKey = "expoAutoAttendance.geofence"
  private let lastEventKey = "expoAutoAttendance.lastEvent"

  private let defaults: UserDefaults
  private let journalURL: URL
  private let lock = NSRecursiveLock()

  init(defaults: UserDefaults = .standard, journalURL: URL? = nil) {
    self.defaults = defaults
    self.journalURL = journalURL ?? FileManager.default.urls(
      for: .applicationSupportDirectory, in: .userDomainMask
    )[0].appendingPathComponent("ExpoAutoAttendance/pending-events.json")
  }

  private func locked<T>(_ operation: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try operation()
  }

  var isMonitoring: Bool {
    return locked { defaults.bool(forKey: monitoringKey) }
  }

  func saveGeofence(_ geofence: [String: Any]) {
    locked {
      defaults.set(geofence, forKey: geofenceKey)
      defaults.set(true, forKey: monitoringKey)
    }
  }

  func clearGeofence() {
    locked {
      defaults.removeObject(forKey: geofenceKey)
      defaults.set(false, forKey: monitoringKey)
    }
  }

  /// An OS failure must not masquerade as a live registration. Keep the desired
  /// geometry/scope so the existing registrar can retry after recovery.
  func invalidateMonitoring() {
    locked { defaults.set(false, forKey: monitoringKey) }
  }

  func getGeofence() -> [String: Any]? {
    return locked { defaults.dictionary(forKey: geofenceKey) }
  }

  private func readJournal() throws -> [String: Any] {
    if FileManager.default.fileExists(atPath: journalURL.path) {
      let data = try Data(contentsOf: journalURL)
      guard let journal = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        (journal["version"] as? NSNumber)?.intValue == 1,
        journal["events"] is [[String: Any]],
        journal["nextSequence"] is NSNumber else {
        throw NSError(domain: "ExpoAutoAttendance", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Native event journal is invalid"])
      }
      return journal
    }

    // A legacy event has no proven employee/tenant. Preserve it once without
    // assigning current registration metadata or treating it as new attendance.
    var events: [[String: Any]] = []
    if var legacy = defaults.dictionary(forKey: lastEventKey) {
      legacy["eventId"] = UUID().uuidString
      legacy["sequence"] = 1
      legacy["captureIssue"] = "legacy-unattributed"
      events.append(legacy)
    }
    let journal: [String: Any] = ["version": 1, "nextSequence": events.count, "events": events]
    try writeJournal(journal)
    return journal
  }

  private func writeJournal(_ journal: [String: Any]) throws {
    let directory = journalURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: journal, options: [.sortedKeys])
    // Until-first-unlock protection supports region wakes while the screen is
    // locked after first unlock. File/OS failures propagate; never emit success.
#if os(iOS)
    try data.write(to: journalURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
#else
    try data.write(to: journalURL, options: [.atomic])
#endif
    let file = try FileHandle(forWritingTo: journalURL)
    defer { try? file.close() }
    try file.synchronize()
  }

  /// No capacity/age eviction: every callback survives until its exact ID is
  /// acknowledged after the existing SQLite database owns the ingress record.
  func appendEvent(_ payload: [String: Any]) throws -> [String: Any] {
    return try locked {
      var journal = try readJournal()
      var events = journal["events"] as! [[String: Any]]
      let sequence = (journal["nextSequence"] as! NSNumber).int64Value + 1
      var event = payload
      event["eventId"] = UUID().uuidString
      event["sequence"] = sequence
      events.append(event)
      journal["events"] = events
      journal["nextSequence"] = sequence
      try writeJournal(journal)
      // Legacy getLastEvent is display/old-JS compatibility, never the journal.
      defaults.set(event, forKey: lastEventKey)
      return event
    }
  }

  func getPendingEvents() throws -> [[String: Any]] {
    return try locked { try readJournal()["events"] as! [[String: Any]] }
  }

  func acknowledgeEvent(_ eventId: String) throws -> Bool {
    return try locked {
      var journal = try readJournal()
      let events = journal["events"] as! [[String: Any]]
      let remaining = events.filter { ($0["eventId"] as? String) != eventId }
      guard remaining.count != events.count else { return false }
      journal["events"] = remaining
      try writeJournal(journal)
      return true
    }
  }

  func getLastEvent() -> [String: Any]? {
    return locked { defaults.dictionary(forKey: lastEventKey) }
  }

  func clearLastEvent() throws {
    try locked {
      // Preserve the pre-upgrade slot before a display-only clear can erase it.
      _ = try readJournal()
      defaults.removeObject(forKey: lastEventKey)
    }
  }
}

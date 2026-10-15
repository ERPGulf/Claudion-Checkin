import Foundation

/// UserDefaults preserves the old registration/display API. The atomic journal
/// owns new registration recovery metadata and native ingress, never attendance
/// decisions. JS acknowledges an ID only after transferring it to SQLite.
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

  func getRegistrationState() throws -> [String: Any]? {
    return try locked { try readJournal()["registration"] as? [String: Any] }
  }

  /// Commit ownership before asking the OS to register. A same-ID restoration
  /// keeps completed presence/cooldown; only a new registration starts it anew.
  func savePendingRegistration(_ configuration: [String: Any]) throws {
    try locked {
      var journal = try readJournal()
      let previous = journal["registration"] as? [String: Any]
      let previousConfiguration = previous?["configuration"] as? [String: Any]
      let previousIdentifier = previousConfiguration.flatMap { registrationIdentifier($0) }
      let sameIdentifier = previousIdentifier != nil && previousIdentifier == registrationIdentifier(configuration)
      journal["registration"] = [
        "configuration": configuration, "status": "pending",
        "initialPresencePending": sameIdentifier ? previous?["initialPresencePending"] as? Bool ?? false : true,
        "initialPresenceRetryAfter": sameIdentifier ? previous?["initialPresenceRetryAfter"] as? NSNumber ?? 0 : 0
      ] as [String: Any]
      try writeJournal(journal)
      defaults.set(configuration, forKey: geofenceKey)
      defaults.set(false, forKey: monitoringKey)
    }
  }

  @discardableResult
  func confirmRegistration(_ nativeIdentifier: String) throws -> Bool {
    return try locked {
      var journal = try readJournal()
      guard var registration = journal["registration"] as? [String: Any],
        ["pending", "monitoring"].contains(registration["status"] as? String ?? ""),
        let configuration = registration["configuration"] as? [String: Any],
        registrationIdentifier(configuration) == nativeIdentifier else { return false }
      registration["status"] = "monitoring"
      journal["registration"] = registration
      try writeJournal(journal)
      defaults.set(configuration, forKey: geofenceKey)
      defaults.set(true, forKey: monitoringKey)
      return true
    }
  }

  func cancelRegistration() throws {
    try locked {
      var journal = try readJournal()
      journal["registration"] = NSNull()
      try writeJournal(journal)
      clearGeofence()
    }
  }

  @discardableResult
  func invalidateRegistration(_ nativeIdentifier: String?) throws -> Bool {
    return try locked {
      var journal = try readJournal()
      guard var registration = journal["registration"] as? [String: Any],
        let configuration = registration["configuration"] as? [String: Any],
        nativeIdentifier == nil || registrationIdentifier(configuration) == nativeIdentifier else { return false }
      registration["status"] = "inactive"
      journal["registration"] = registration
      try writeJournal(journal)
      defaults.set(false, forKey: monitoringKey)
      return true
    }
  }

  func beginInitialPresenceRequest(_ nativeIdentifier: String, at: Int64, cooldownMs: Int64 = 60_000) throws -> Bool {
    return try locked {
      var journal = try readJournal()
      guard var registration = journal["registration"] as? [String: Any],
        registration["status"] as? String == "monitoring",
        registration["initialPresencePending"] as? Bool == true,
        let configuration = registration["configuration"] as? [String: Any],
        registrationIdentifier(configuration) == nativeIdentifier,
        ((registration["initialPresenceRetryAfter"] as? NSNumber)?.int64Value ?? 0) <= at else { return false }
      registration["initialPresenceRetryAfter"] = at + cooldownMs
      journal["registration"] = registration
      try writeJournal(journal)
      return true
    }
  }

  @discardableResult
  func completeInitialPresence(_ nativeIdentifier: String) throws -> Bool {
    return try locked {
      var journal = try readJournal()
      guard finishInitialPresence(in: &journal, nativeIdentifier: nativeIdentifier) else { return false }
      try writeJournal(journal)
      return true
    }
  }

  private func registrationIdentifier(_ configuration: [String: Any]) -> String? {
    return configuration["nativeIdentifier"] as? String ?? configuration["identifier"] as? String
  }

  private func finishInitialPresence(in journal: inout [String: Any], nativeIdentifier: String) -> Bool {
    guard var registration = journal["registration"] as? [String: Any],
      ["pending", "monitoring"].contains(registration["status"] as? String ?? ""),
      registration["initialPresencePending"] as? Bool == true,
      let configuration = registration["configuration"] as? [String: Any],
      registrationIdentifier(configuration) == nativeIdentifier else { return false }
    registration["initialPresencePending"] = false
    journal["registration"] = registration
    return true
  }

  private func legacyRegistration() -> Any {
    guard let configuration = defaults.dictionary(forKey: geofenceKey) else { return NSNull() }
    // Existing confirmed monitoring must not create a fresh initial ENTER after
    // upgrade or manual checkout. Its earlier detection cannot be reconstructed.
    return ["configuration": configuration,
      "status": defaults.bool(forKey: monitoringKey) ? "monitoring" : "inactive",
      "initialPresencePending": false, "initialPresenceRetryAfter": 0] as [String: Any]
  }

  private func readJournal() throws -> [String: Any] {
    if FileManager.default.fileExists(atPath: journalURL.path) {
      let data = try Data(contentsOf: journalURL)
      guard var journal = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        (journal["version"] as? NSNumber)?.intValue == 1,
        journal["events"] is [[String: Any]],
        journal["nextSequence"] is NSNumber else {
        throw NSError(domain: "ExpoAutoAttendance", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Native event journal is invalid"])
      }
      if journal["registration"] == nil {
        // Additive migration: retain every existing event, ID and sequence.
        journal["registration"] = legacyRegistration()
        try writeJournal(journal)
      } else if let registration = journal["registration"] as? [String: Any] {
        guard registration["configuration"] is [String: Any],
          ["pending", "monitoring", "inactive"].contains(registration["status"] as? String ?? ""),
          registration["initialPresencePending"] is Bool,
          registration["initialPresenceRetryAfter"] is NSNumber else {
          throw NSError(domain: "ExpoAutoAttendance", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Native registration journal is invalid"])
        }
      } else if !(journal["registration"] is NSNull) {
        throw NSError(domain: "ExpoAutoAttendance", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Native registration journal is invalid"])
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
    let journal: [String: Any] = ["version": 1, "nextSequence": events.count, "events": events,
      "registration": legacyRegistration()]
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
  func appendEvent(_ payload: [String: Any], completingInitialPresenceFor nativeIdentifier: String? = nil) throws -> [String: Any] {
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
      if let nativeIdentifier { _ = finishInitialPresence(in: &journal, nativeIdentifier: nativeIdentifier) }
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

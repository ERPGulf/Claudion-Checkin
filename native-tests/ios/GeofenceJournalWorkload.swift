import Foundation

/// Isolated Foundation workload for the production serialized journal.
/// This measures host filesystem work; it does not measure iOS energy, locked
/// data protection, Core Location delivery, or Android SharedPreferences.
private final class WorkloadDefaults: UserDefaults {
  private var values: [String: Any] = [:]
  override func set(_ value: Any?, forKey key: String) { values[key] = value }
  override func bool(forKey key: String) -> Bool { values[key] as? Bool ?? false }
  override func dictionary(forKey key: String) -> [String: Any]? { values[key] as? [String: Any] }
  override func removeObject(forKey key: String) { values.removeValue(forKey: key) }
}

@main
struct GeofenceJournalWorkload {
  static func main() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("claudion-journal-workload-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    for count in [100, 500] {
      let url = directory.appendingPathComponent("events-\(count).json")
      let defaults = WorkloadDefaults()
      let store = GeofenceStore(defaults: defaults, journalURL: url)
      let startedAt = ProcessInfo.processInfo.systemUptime
      for index in 0..<count {
        _ = try store.appendEvent([
          "identifier": "office-main", "nativeIdentifier": "synthetic-registration",
          "tenantKey": "https://synthetic.invalid", "employeeId": "SYNTHETIC-EMPLOYEE",
          "registrationId": "synthetic-configuration", "geotagging": 2,
          "latitude": 1.0, "longitude": 2.0, "radius": 100.0,
          "transition": index % 2 == 0 ? "ENTER" : "EXIT", "timestamp": 1000 + index
        ])
      }
      let appendMs = (ProcessInfo.processInfo.systemUptime - startedAt) * 1000
      let readStartedAt = ProcessInfo.processInfo.systemUptime
      let restored = try GeofenceStore(defaults: defaults, journalURL: url).getPendingEvents()
      let readMs = (ProcessInfo.processInfo.systemUptime - readStartedAt) * 1000
      precondition(restored.count == count, "Workload must retain every synthetic capture")
      let bytes = try Data(contentsOf: url).count
      let ackStartedAt = ProcessInfo.processInfo.systemUptime
      _ = try store.acknowledgeEvent(restored[0]["eventId"] as! String)
      let acknowledgeMs = (ProcessInfo.processInfo.systemUptime - ackStartedAt) * 1000
      let remaining = try store.getPendingEvents()
      precondition(remaining.count == count - 1, "Only exact acknowledgment may remove a capture")
      let result: [String: Any] = ["events": count, "appendTotalMs": appendMs,
        "appendMeanMs": appendMs / Double(count), "reopenReadMs": readMs,
        "acknowledgeOneMs": acknowledgeMs, "journalBytes": bytes]
      let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      print(String(decoding: json, as: UTF8.self))
    }
  }
}

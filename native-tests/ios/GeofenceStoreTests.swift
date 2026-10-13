import Foundation

/// Native Foundation-only regression harness. Compile with GeofenceStore.swift;
/// it exercises actual file persistence, not Core Location or OS wake behavior.
private final class MemoryDefaults: UserDefaults {
  private var values: [String: Any] = [:]

  override func set(_ value: Any?, forKey defaultName: String) {
    values[defaultName] = value
  }

  override func bool(forKey defaultName: String) -> Bool {
    values[defaultName] as? Bool ?? false
  }

  override func dictionary(forKey defaultName: String) -> [String: Any]? {
    values[defaultName] as? [String: Any]
  }

  override func removeObject(forKey defaultName: String) {
    values.removeValue(forKey: defaultName)
  }
}

private enum TestFailure: Error { case assertion(String) }

@main
struct GeofenceStoreTests {
  private static var checks = 0

  private static func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw TestFailure.assertion(message) }
    checks += 1
  }

  private static func event(_ transition: String, _ timestamp: Int64 = 1_000) -> [String: Any] {
    [
      "identifier": "office-main", "nativeIdentifier": "native-synthetic",
      "transition": transition, "timestamp": timestamp,
      "tenantKey": "https://synthetic.invalid", "employeeId": "EMP-SYNTHETIC",
      "registrationId": "config-synthetic", "geotagging": 2,
      "latitude": 1.0, "longitude": 2.0, "radius": 100.0, "requestedRadius": 500.0
    ]
  }

  static func main() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("claudion-native-events-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let defaults = MemoryDefaults()
    let url = directory.appendingPathComponent("events.json")
    let store = GeofenceStore(defaults: defaults, journalURL: url)

    store.saveGeofence(["identifier": "office-main", "nativeIdentifier": "native-synthetic",
      "tenantKey": "https://synthetic.invalid", "employeeId": "EMP-SYNTHETIC"])
    try check(store.isMonitoring, "Saved registration marks monitoring active")
    store.invalidateMonitoring()
    try check(!store.isMonitoring, "OS failure invalidates active bookkeeping")
    try check(store.getGeofence()?["employeeId"] as? String == "EMP-SYNTHETIC",
      "Failure retains desired scoped configuration for recovery")

    let first = try store.appendEvent(event("ENTER"))
    let second = try store.appendEvent(event("EXIT", 2_000))
    let firstId = first["eventId"] as! String
    let secondId = second["eventId"] as! String
    let pending = try store.getPendingEvents()
    try check(pending.count == 2, "ENTER and EXIT must both survive")
    try check(firstId != secondId, "Each native callback needs a distinct ID")
    try check((pending[0]["sequence"] as? NSNumber)?.intValue == 1, "Sequence starts at one")
    try check((pending[1]["sequence"] as? NSNumber)?.intValue == 2, "Sequence preserves callback order")
    try check(pending[0]["tenantKey"] as? String == "https://synthetic.invalid", "Scope must persist")
    try check(pending[0]["registrationId"] as? String == "config-synthetic", "Configuration must persist")
    try check((pending[0]["requestedRadius"] as? NSNumber)?.doubleValue == 500,
      "Requested radius survives a native platform clamp")
    try check((pending[0]["radius"] as? NSNumber)?.doubleValue == 100,
      "Actual monitored radius remains the callback geometry")

    let restarted = GeofenceStore(defaults: defaults, journalURL: url)
    let restored = try restarted.getPendingEvents()
    try check(restored.map { $0["eventId"] as! String } == [firstId, secondId], "Restart retains exact IDs/order")
    try restarted.clearLastEvent()
    let afterDisplayClear = try restarted.getPendingEvents()
    try check(afterDisplayClear.count == 2, "Clearing display event must never clear journal")
    let acknowledged = try restarted.acknowledgeEvent(firstId)
    let acknowledgedAgain = try restarted.acknowledgeEvent(firstId)
    try check(acknowledged, "Exact persisted event can be acknowledged")
    try check(!acknowledgedAgain, "Repeated acknowledgment has no effect")
    let afterAck = try restarted.getPendingEvents()
    try check(afterAck.map { $0["eventId"] as! String } == [secondId], "Ack cannot consume another event")
    let third = try restarted.appendEvent(event("ENTER", 3_000))
    try check((third["sequence"] as? NSNumber)?.intValue == 3, "Ack/restart cannot reset sequence")

    let legacyDefaults = MemoryDefaults()
    legacyDefaults.set(["identifier": "office-main", "transition": "EXIT", "timestamp": 800],
      forKey: "expoAutoAttendance.lastEvent")
    let legacyURL = directory.appendingPathComponent("legacy.json")
    let migrated = GeofenceStore(defaults: legacyDefaults, journalURL: legacyURL)
    let legacy = try migrated.getPendingEvents()
    try check(legacy.count == 1, "Legacy slot is preserved once")
    try check(legacy[0]["captureIssue"] as? String == "legacy-unattributed", "Legacy identity must stay unknown")
    try check(legacy[0]["tenantKey"] == nil && legacy[0]["employeeId"] == nil, "Never invent legacy scope")
    let legacyId = legacy[0]["eventId"] as! String
    let migratedRestart = GeofenceStore(defaults: legacyDefaults, journalURL: legacyURL)
    let migratedAgain = try migratedRestart.getPendingEvents()
    try check(migratedAgain[0]["eventId"] as? String == legacyId, "Migration ID must survive restart")
    _ = try migratedRestart.acknowledgeEvent(legacyId)
    let migratedEmpty = try migratedRestart.getPendingEvents()
    try check(migratedEmpty.isEmpty, "Acknowledged legacy slot cannot migrate again")

    let clearDefaults = MemoryDefaults()
    clearDefaults.set(["identifier": "office-main", "transition": "ENTER", "timestamp": 700],
      forKey: "expoAutoAttendance.lastEvent")
    let clearBeforeRead = GeofenceStore(defaults: clearDefaults, journalURL: directory.appendingPathComponent("clear-first.json"))
    try clearBeforeRead.clearLastEvent()
    let clearMigrated = try clearBeforeRead.getPendingEvents()
    try check(clearMigrated.count == 1, "Display clear first preserves the unmigrated legacy capture")
    try check(clearBeforeRead.getLastEvent() == nil, "Display clear remains display-only after migration")

    // Shared store calls from JS and the delegate must not overwrite each other.
    let concurrentURL = directory.appendingPathComponent("concurrent.json")
    let concurrent = GeofenceStore(defaults: MemoryDefaults(), journalURL: concurrentURL)
    let errorsLock = NSLock()
    var errors: [Error] = []
    DispatchQueue.concurrentPerform(iterations: 80) { index in
      do { _ = try concurrent.appendEvent(event(index % 2 == 0 ? "ENTER" : "EXIT", Int64(index))) }
      catch { errorsLock.lock(); errors.append(error); errorsLock.unlock() }
    }
    let concurrentEvents = try concurrent.getPendingEvents()
    try check(errors.isEmpty, "Concurrent capture must not fail")
    try check(concurrentEvents.count == 80, "Concurrent callbacks must all remain")
    try check(Set(concurrentEvents.map { $0["eventId"] as! String }).count == 80, "Concurrent IDs are distinct")
    try check(concurrentEvents.map { ($0["sequence"] as! NSNumber).intValue } == Array(1...80),
      "Concurrent persistence order is monotonic")

    // IO/corruption cannot be reported as capture/ack success or reset history.
    let blockedParent = directory.appendingPathComponent("file-instead-of-directory")
    try Data("block".utf8).write(to: blockedParent)
    let blocked = GeofenceStore(defaults: MemoryDefaults(),
      journalURL: blockedParent.appendingPathComponent("events.json"))
    do {
      _ = try blocked.appendEvent(event("ENTER"))
      throw TestFailure.assertion("Storage failure must propagate")
    } catch is TestFailure { throw TestFailure.assertion("Storage failure must propagate") }
    catch { checks += 1 }
    try Data("corrupt journal".utf8).write(to: url)
    do {
      _ = try restarted.acknowledgeEvent(secondId)
      throw TestFailure.assertion("Corruption must not acknowledge an event")
    } catch is TestFailure { throw TestFailure.assertion("Corruption must not acknowledge an event") }
    catch { checks += 1 }
    let unchanged = try String(contentsOf: url, encoding: .utf8)
    try check(unchanged == "corrupt journal", "Corrupt evidence must never be overwritten")

    print("GeofenceStore native persistence checks passed: \(checks)")
  }
}

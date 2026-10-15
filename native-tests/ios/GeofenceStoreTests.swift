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
      "registrationId": "config-synthetic", "geotagging": 2, "registrationStartedAt": 100,
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

    // Ownership must survive death between OS registration and confirmation.
    let registrationURL = directory.appendingPathComponent("registration.json")
    let registration = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let configuration = event("ENTER").filter { !["transition", "timestamp"].contains($0.key) }
    try registration.savePendingRegistration(configuration)
    let pendingRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let pendingRegistration = try pendingRestart.getRegistrationState()
    try check(pendingRegistration?["status"] as? String == "pending", "Pending registration survives restart before OS confirmation")
    let pendingConfiguration = pendingRegistration?["configuration"] as? [String: Any]
    try check(pendingConfiguration?["employeeId"] as? String == "EMP-SYNTHETIC", "Pending employee scope survives without UserDefaults")
    try check(pendingConfiguration?["nativeIdentifier"] as? String == "native-synthetic", "Restore retains the exact physical region identity")
    try check((pendingConfiguration?["registrationStartedAt"] as? NSNumber)?.intValue == 100,
      "Restart retains registration time rather than stamping relaunch time")
    let confirmed = try pendingRestart.confirmRegistration("native-synthetic")
    try check(confirmed, "Matching OS confirmation promotes the durable registration")
    let firstRequest = try pendingRestart.beginInitialPresenceRequest("native-synthetic", at: 1_000)
    try check(firstRequest, "An unfinished initial presence starts one authoritative request cycle")
    let presenceRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let unresolved = try presenceRestart.getRegistrationState()
    try check(unresolved?["initialPresencePending"] as? Bool == true, "Restart/unknown exhaustion retains unfinished initial presence")
    let tooSoon = try presenceRestart.beginInitialPresenceRequest("native-synthetic", at: 60_999)
    let retryLater = try presenceRestart.beginInitialPresenceRequest("native-synthetic", at: 61_000)
    try check(!tooSoon && retryLater, "Unknown/restarted initial presence retries only after the persisted cooldown")
    let outsideResolved = try presenceRestart.completeInitialPresence("native-synthetic")
    try check(outsideResolved, "Authoritative outside settles initial presence without an EXIT")
    let outsideEvents = try presenceRestart.getPendingEvents()
    try check(outsideEvents.isEmpty, "Initial outside never manufactures an attendance transition")
    let completedRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let afterManualCheckout = try completedRestart.beginInitialPresenceRequest("native-synthetic", at: 500_000)
    try check(!afterManualCheckout, "Completed initial presence cannot reopen attendance after manual checkout")
    try completedRestart.savePendingRegistration(configuration)
    _ = try completedRestart.confirmRegistration("native-synthetic")
    let restoredCompleted = try completedRestart.beginInitialPresenceRequest("native-synthetic", at: 550_000)
    try check(!restoredCompleted, "Restoring a missing OS region with the same identity keeps completed presence")

    var replacement = configuration
    replacement["nativeIdentifier"] = "native-replacement"
    replacement["employeeId"] = "EMP-OTHER-SYNTHETIC"
    try completedRestart.savePendingRegistration(replacement)
    let staleConfirmation = try completedRestart.confirmRegistration("native-synthetic")
    let stalePresence = try completedRestart.completeInitialPresence("native-synthetic")
    try check(!staleConfirmation && !stalePresence, "Late callbacks cannot confirm or settle a replacement registration")
    _ = try completedRestart.confirmRegistration("native-replacement")
    var crossing = event("EXIT", 5_000)
    crossing["nativeIdentifier"] = "native-replacement"
    crossing["employeeId"] = "EMP-OTHER-SYNTHETIC"
    let boundary = try completedRestart.appendEvent(crossing, completingInitialPresenceFor: "native-replacement")
    let boundaryRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let boundaryState = try boundaryRestart.getRegistrationState()
    let boundaryRetry = try boundaryRestart.beginInitialPresenceRequest("native-replacement", at: 600_000)
    try check(boundaryState?["initialPresencePending"] as? Bool == false && !boundaryRetry,
      "Real ENTER/EXIT atomically finishes initial presence before replay or retry")
    let crossingEvents = try boundaryRestart.getPendingEvents()
    try check(crossingEvents.count == 1 && crossingEvents[0]["eventId"] as? String == boundary["eventId"] as? String,
      "Finishing presence retains the genuine crossing with its stable identity")
    try boundaryRestart.cancelRegistration()
    let stoppedRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: registrationURL)
    let stoppedState = try stoppedRestart.getRegistrationState()
    let lateAfterStop = try stoppedRestart.confirmRegistration("native-replacement")
    try check(stoppedState == nil && !lateAfterStop, "Durable stop prevents late confirmation from resurrecting registration")
    let retainedAfterStop = try stoppedRestart.getPendingEvents()
    try check(retainedAfterStop.count == 1, "Stopping monitoring preserves captured receipts")
    let staleDefaults = MemoryDefaults()
    staleDefaults.set(replacement, forKey: "expoAutoAttendance.geofence")
    staleDefaults.set(true, forKey: "expoAutoAttendance.monitoring")
    let cancelledWithStaleMirror = GeofenceStore(defaults: staleDefaults, journalURL: registrationURL)
    let cancelledDespiteMirror = try cancelledWithStaleMirror.getRegistrationState()
    try check(cancelledDespiteMirror == nil, "Durable stop wins even if the compatibility mirror was not cleared before death")

    let initialURL = directory.appendingPathComponent("initial-presence.json")
    let initialStore = GeofenceStore(defaults: MemoryDefaults(), journalURL: initialURL)
    try initialStore.savePendingRegistration(configuration)
    _ = try initialStore.confirmRegistration("native-synthetic")
    var initialEvent = event("ENTER", 8_000)
    initialEvent["initialPresence"] = true
    let initialCapture = try initialStore.appendEvent(initialEvent, completingInitialPresenceFor: "native-synthetic")
    let initialRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: initialURL)
    let restoredInitial = try initialRestart.getPendingEvents()
    let initialState = try initialRestart.getRegistrationState()
    try check(restoredInitial[0]["initialPresence"] as? Bool == true,
      "Authoritative initial ENTER retains its distinct source marker through replay")
    try check((restoredInitial[0]["registrationStartedAt"] as? NSNumber)?.intValue == 100,
      "Initial ENTER retains its original scoped registration start time")
    try check(initialState?["initialPresencePending"] as? Bool == false,
      "Initial ENTER and completed detection share one atomic durable write")
    _ = try initialRestart.acknowledgeEvent(initialCapture["eventId"] as! String)
    let afterInitialAck = try initialRestart.beginInitialPresenceRequest("native-synthetic", at: 600_000)
    try check(!afterInitialAck, "Acknowledging initial ENTER cannot reset completed presence")
    try check(crossingEvents[0]["initialPresence"] == nil, "Genuine crossing retains no initial-presence marker")

    // Old confirmed registrations never acquire a fresh initial ENTER on upgrade.
    let oldDefaults = MemoryDefaults()
    oldDefaults.set(configuration, forKey: "expoAutoAttendance.geofence")
    oldDefaults.set(true, forKey: "expoAutoAttendance.monitoring")
    let oldStore = GeofenceStore(defaults: oldDefaults, journalURL: directory.appendingPathComponent("old-registration.json"))
    let oldState = try oldStore.getRegistrationState()
    try check(oldState?["status"] as? String == "monitoring" && oldState?["initialPresencePending"] as? Bool == false,
      "Legacy confirmed registration migrates without inventing unfinished presence")
    let existingURL = directory.appendingPathComponent("existing-v1.json")
    var existingEvent = event("EXIT")
    existingEvent["eventId"] = "existing-stable-id"
    existingEvent["sequence"] = 10
    try JSONSerialization.data(withJSONObject: ["version": 1, "events": [existingEvent], "nextSequence": 10])
      .write(to: existingURL, options: .atomic)
    let existingStore = GeofenceStore(defaults: oldDefaults, journalURL: existingURL)
    let existingState = try existingStore.getRegistrationState()
    let existingEvents = try existingStore.getPendingEvents()
    let afterMigration = try existingStore.appendEvent(event("ENTER"))
    try check(existingState?["initialPresencePending"] as? Bool == false,
      "An existing v1 journal gains registration metadata without a new presence request")
    try check(existingEvents[0]["eventId"] as? String == "existing-stable-id" &&
      (afterMigration["sequence"] as? NSNumber)?.intValue == 11,
      "Additive registration migration preserves existing event identity and sequence")
    let invalidated = try existingStore.invalidateRegistration("native-synthetic")
    let invalidState = try existingStore.getRegistrationState()
    let invalidConfig = invalidState?["configuration"] as? [String: Any]
    try check(invalidated && invalidState?["status"] as? String == "inactive" &&
      invalidConfig?["employeeId"] as? String == "EMP-SYNTHETIC",
      "OS monitoring failure retains original scoped desired registration durably")

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
    do {
      try blocked.savePendingRegistration(configuration)
      throw TestFailure.assertion("Pending ownership storage failure must propagate before OS registration")
    } catch is TestFailure { throw TestFailure.assertion("Pending ownership storage failure must propagate before OS registration") }
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

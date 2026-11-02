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

    // OS-confirmed loss is a control receipt, never a manufactured EXIT. Its
    // episode survives acknowledgement, repeated probes and process restart.
    let accessURL = directory.appendingPathComponent("access.json")
    let access = GeofenceStore(defaults: MemoryDefaults(), journalURL: accessURL)
    try access.savePendingRegistration(configuration)
    _ = try access.confirmRegistration("native-synthetic")
    let accessConfiguration = try access.getRegistrationState()!["configuration"] as! [String: Any]
    let accessGeneration = accessConfiguration["registrationGeneration"] as! String
    let loss = try access.observeAccessLoss(reason: "services-disabled", at: 10_000)!
    let lossId = loss["eventId"] as! String
    let duplicateLoss = try access.observeAccessLoss(reason: "precise-permission-lost", at: 11_000)
    try check(duplicateLoss == nil, "Repeated confirmed revocations reuse one episode")
    try check(loss["kind"] as? String == "LOCATION_ACCESS_LOST" && loss["transition"] == nil,
      "Access loss never manufactures a geofence EXIT")
    try check(access.getLastEvent() == nil, "Control receipts never replace the compatibility transition slot")
    _ = try access.acknowledgeEvent(lossId)
    let accessRestart = GeofenceStore(defaults: MemoryDefaults(), journalURL: accessURL)
    let restoredEpisode = try accessRestart.getAccessEpisode()
    try check(restoredEpisode?["lossEventId"] as? String == lossId &&
      (restoredEpisode?["firstObservedAt"] as? NSNumber)?.int64Value == 10_000,
      "Restart and acknowledgement preserve the first observable loss time")
    try accessRestart.savePendingRegistration(accessConfiguration)
    let repairedConfiguration = try accessRestart.getRegistrationState()!["configuration"] as! [String: Any]
    try check(repairedConfiguration["registrationGeneration"] as? String == accessGeneration,
      "Repair preserves the durable logical registration generation")
    var pendingEnter = accessConfiguration
    pendingEnter["transition"] = "ENTER"
    pendingEnter["timestamp"] = 11_500
    let recoveryEnter = try accessRestart.appendEvent(pendingEnter)
    try check(recoveryEnter["lossEventId"] as? String == lossId,
      "An ENTER during recovery remains permanently tagged as non-authorizing evidence")
    var position: [String: Any] = ["latitude": 1.0, "longitude": 2.0,
      "horizontalAccuracy": 200.0, "timestamp": 12_001]
    let uncertain = try accessRestart.completeAccessRecovery(lossEventId: lossId,
      registrationGeneration: accessGeneration, requestedAt: 12_000, position: position, observedAt: 13_000)
    let pendingUncertainEpisode = try accessRestart.getAccessEpisode()
    try check(uncertain == nil && pendingUncertainEpisode != nil,
      "Indoor imprecise GPS leaves recovery pending without another punch")
    position["horizontalAccuracy"] = 5.0
    position["timestamp"] = 11_999
    let cachedRecovery = try accessRestart.completeAccessRecovery(lossEventId: lossId,
      registrationGeneration: accessGeneration, requestedAt: 12_000, position: position, observedAt: 13_000)
    try check(cachedRecovery == nil, "Cached fixes cannot establish recovery presence")
    position["timestamp"] = 12_001
    let wrongGeneration = try accessRestart.completeAccessRecovery(lossEventId: lossId,
      registrationGeneration: "stale-generation", requestedAt: 12_000, position: position, observedAt: 13_000)
    let wrongLoss = try accessRestart.completeAccessRecovery(lossEventId: "another-loss",
      registrationGeneration: accessGeneration, requestedAt: 12_000, position: position, observedAt: 13_000)
    try check(wrongGeneration == nil && wrongLoss == nil, "Stale generation/loss cannot settle the episode")
    let recovered = try accessRestart.completeAccessRecovery(lossEventId: lossId,
      registrationGeneration: accessGeneration, requestedAt: 12_000, position: position, observedAt: 13_000)!
    try check(recovered["kind"] as? String == "LOCATION_ACCESS_RECOVERED" && recovered["presence"] as? String == "inside",
      "Only fresh accuracy-verified presence completes recovery")
    let repeatedRecovery = try accessRestart.completeAccessRecovery(lossEventId: lossId,
      registrationGeneration: accessGeneration, requestedAt: 12_000, position: position, observedAt: 13_000)
    try check(repeatedRecovery == nil, "A successful recovery cannot append twice")
    pendingEnter["initialPresence"] = true
    let lateInitial = try accessRestart.appendEvent(pendingEnter)
    try check(lateInitial["lossEventId"] as? String == lossId,
      "An initial ENTER after native recovery cannot bypass pending JS cutoff processing")
    let retainedSlot = accessRestart.getLastEvent()
    try check(retainedSlot?["transition"] as? String == "ENTER", "Control recovery never overwrites legacy display with a fake crossing")
    let secondLoss = try accessRestart.observeAccessLoss(reason: "background-permission-lost", at: 14_000)!
    try check(secondLoss["eventId"] as? String != lossId, "A later interruption receives a distinct episode")
    try accessRestart.cancelRegistration()
    let cancelledEpisode = try accessRestart.getAccessEpisode()
    try check(cancelledEpisode == nil, "Intentional cancellation resolves recovery without deleting receipts")
    let retainedAccessEvents = try accessRestart.getPendingEvents()
    try check(retainedAccessEvents.contains { $0["eventId"] as? String == secondLoss["eventId"] as? String },
      "Cancellation retains the original loss receipt for safe replay/review")
    let repairStore = GeofenceStore(defaults: MemoryDefaults(), journalURL: directory.appendingPathComponent("repair-access.json"))
    try repairStore.savePendingRegistration(configuration)
    _ = try repairStore.confirmRegistration("native-synthetic")
    _ = try repairStore.completeInitialPresence("native-synthetic")
    let repairLoss = try repairStore.observeAccessLoss(reason: "services-disabled", at: 20_000)!
    var repairedPhysical = try repairStore.getRegistrationState()!["configuration"] as! [String: Any]
    let repairGeneration = repairedPhysical["registrationGeneration"] as! String
    repairedPhysical["nativeIdentifier"] = "native-repaired-instance"
    try repairStore.savePendingRegistration(repairedPhysical)
    let repairedState = try repairStore.getRegistrationState()
    let repairedEpisode = try repairStore.getAccessEpisode()
    try check(repairedEpisode?["lossEventId"] as? String == repairLoss["eventId"] as? String &&
      repairedState?["initialPresencePending"] as? Bool == false,
      "Same-generation physical repair retains interruption and completed initial presence")
    var newIntent = repairedPhysical
    newIntent["nativeIdentifier"] = "native-new-intent"
    newIntent.removeValue(forKey: "registrationGeneration")
    try repairStore.savePendingRegistration(newIntent)
    let replacedState = try repairStore.getRegistrationState()!["configuration"] as! [String: Any]
    let replacedEpisode = try repairStore.getAccessEpisode()
    try check(replacedState["registrationGeneration"] as? String != repairGeneration && replacedEpisode == nil,
      "A genuine new generation cancels recovery without adopting its predecessor's episode")
    let invalidReason = try repairStore.observeAccessLoss(reason: "weak-gps", at: 21_000)
    try check(invalidReason == nil, "Signal-quality failures cannot create access-loss receipts")
    let outsideLoss = try repairStore.observeAccessLoss(reason: "services-disabled", at: 22_000)!
    let outsideGeneration = replacedState["registrationGeneration"] as! String
    let outsidePosition: [String: Any] = ["latitude": 1.002, "longitude": 2.0,
      "horizontalAccuracy": 5.0, "timestamp": 22_002]
    let outsideRecovery = try repairStore.completeAccessRecovery(lossEventId: outsideLoss["eventId"] as! String,
      registrationGeneration: outsideGeneration, requestedAt: 22_001,
      position: outsidePosition, observedAt: 23_000)
    try check(outsideRecovery?["presence"] as? String == "outside" && outsideRecovery?["transition"] == nil,
      "Verified outside recovery remains a non-punch control receipt")
    try check(repairStore.getLastEvent() == nil, "Neither access cutoff nor outside proof manufactures a displayed geofence crossing")
    try check(LocationAccessGeometry.classify(distance: 90, accuracy: 10, radius: 100) == "inside",
      "Inside threshold equality is inside")
    try check(LocationAccessGeometry.classify(distance: 110, accuracy: 10, radius: 100) == nil,
      "Outside threshold equality is uncertain")
    try check(LocationAccessGeometry.classify(distance: 111, accuracy: 10, radius: 100) == "outside",
      "Only accuracy-adjusted distance strictly beyond the fence is outside")
    try check(LocationAccessGeometry.classify(distance: 0, accuracy: 200, radius: 100) == nil &&
      LocationAccessGeometry.classify(distance: 0, accuracy: -1, radius: 100) == nil,
      "Large and invalid accuracy never establish presence")
    let gate = LocationAccessAttemptGate()
    let firstAttempt = gate.begin(lossEventId: lossId, registrationGeneration: accessGeneration, requestedAt: 15_000, uptime: 100)!
    try check(firstAttempt.isWithinDeadline(at: 114.999), "Fresh recovery may complete before its deadline")
    try check(!firstAttempt.isWithinDeadline(at: 115) && !firstAttempt.isWithinDeadline(at: 1000),
      "A suspended timeout cannot accept a callback at or after its monotonic deadline")
    let concurrentAttempt = gate.begin(lossEventId: lossId, registrationGeneration: accessGeneration, requestedAt: 15_001)
    try check(concurrentAttempt == nil, "Only one current-location request can own an episode")
    _ = gate.finish(firstAttempt.id) // Timeout invalidates ownership before cancellation/retry.
    let nextAttempt = gate.begin(lossEventId: lossId, registrationGeneration: accessGeneration, requestedAt: 30_000)!
    try check(gate.finish(firstAttempt.id) == nil && gate.current?.id == nextAttempt.id,
      "Timed-out callbacks cannot settle a newer recovery attempt")
    _ = gate.finish(nextAttempt.id)
    let restartedGate = LocationAccessAttemptGate()
    try check(restartedGate.begin(lossEventId: lossId, registrationGeneration: accessGeneration, requestedAt: 31_000) != nil,
      "Process restart has no everlasting in-flight request flag")

    // Deterministic state-layer contract for a provider stream: rejected cached
    // and uncertain observations leave one attempt available for a fresh fix.
    // This does not execute CLLocationManagerDelegate delivery or its timer.
    let streamingStore = GeofenceStore(defaults: MemoryDefaults(),
      journalURL: directory.appendingPathComponent("streaming-recovery.json"))
    try streamingStore.savePendingRegistration(configuration)
    _ = try streamingStore.confirmRegistration("native-synthetic")
    let streamingConfiguration = try streamingStore.getRegistrationState()!["configuration"] as! [String: Any]
    let streamingGeneration = streamingConfiguration["registrationGeneration"] as! String
    let streamingLoss = try streamingStore.observeAccessLoss(reason: "services-disabled", at: 49_000)!
    let streamingLossId = streamingLoss["eventId"] as! String
    let streamingGate = LocationAccessAttemptGate()
    let streamingAttempt = streamingGate.begin(lossEventId: streamingLossId,
      registrationGeneration: streamingGeneration, requestedAt: 50_000, uptime: 200)!
    var streamingPosition: [String: Any] = ["latitude": 1.0, "longitude": 2.0,
      "horizontalAccuracy": 5.0, "timestamp": 49_999]
    let streamingCached = try streamingStore.completeAccessRecovery(lossEventId: streamingAttempt.lossEventId,
      registrationGeneration: streamingAttempt.registrationGeneration, requestedAt: streamingAttempt.requestedAt,
      position: streamingPosition, observedAt: 51_000)
    try check(streamingCached == nil && streamingGate.current?.id == streamingAttempt.id,
      "A cached observation cannot settle or replace the pending recovery attempt")
    streamingPosition["horizontalAccuracy"] = 200.0
    streamingPosition["timestamp"] = 50_001
    let streamingUncertain = try streamingStore.completeAccessRecovery(lossEventId: streamingAttempt.lossEventId,
      registrationGeneration: streamingAttempt.registrationGeneration, requestedAt: streamingAttempt.requestedAt,
      position: streamingPosition, observedAt: 51_000)
    try check(streamingUncertain == nil && streamingGate.current?.id == streamingAttempt.id,
      "An uncertain observation leaves the same attempt pending for a better fix")
    try check(streamingGate.begin(lossEventId: streamingLossId, registrationGeneration: streamingGeneration,
      requestedAt: 51_001, uptime: 201) == nil,
      "Rejected observations cannot admit a concurrent second recovery request")
    let streamingPendingEvents = try streamingStore.getPendingEvents()
    try check(streamingPendingEvents.count == 1 && streamingPendingEvents[0]["eventId"] as? String == streamingLossId,
      "Cached and uncertain observations append no recovery receipts or attendance transitions")
    let streamingEpisode = try streamingStore.getAccessEpisode()
    try check(streamingEpisode?["lossEventId"] as? String == streamingLossId &&
      (streamingEpisode?["firstObservedAt"] as? NSNumber)?.int64Value == 49_000,
      "Rejected observations preserve the original durable loss provenance and timestamp")
    streamingPosition["horizontalAccuracy"] = 5.0
    streamingPosition["timestamp"] = 52_000
    let streamingRecovered = try streamingStore.completeAccessRecovery(lossEventId: streamingAttempt.lossEventId,
      registrationGeneration: streamingAttempt.registrationGeneration, requestedAt: streamingAttempt.requestedAt,
      position: streamingPosition, observedAt: 53_000)
    try check(streamingAttempt.isWithinDeadline(at: 203) && streamingRecovered?["presence"] as? String == "inside" &&
      (streamingRecovered?["fixRequestedAt"] as? NSNumber)?.int64Value == 50_000,
      "A later fresh fix completes recovery using the original attempt's request time")
    try check(streamingGate.finish(streamingAttempt.id)?.id == streamingAttempt.id && streamingGate.current == nil,
      "Fresh accepted recovery can release its exact request ownership once")
    let streamingCompletedEvents = try streamingStore.getPendingEvents()
    try check(streamingCompletedEvents.count == 2 && streamingCompletedEvents[1]["kind"] as? String == "LOCATION_ACCESS_RECOVERED" &&
      streamingCompletedEvents[1]["transition"] == nil,
      "One provider stream creates only loss then recovery control receipts in journal order")
    let streamingRepeated = try streamingStore.completeAccessRecovery(lossEventId: streamingAttempt.lossEventId,
      registrationGeneration: streamingAttempt.registrationGeneration, requestedAt: streamingAttempt.requestedAt,
      position: streamingPosition, observedAt: 53_000)
    let streamingAfterRepeated = try streamingStore.getPendingEvents()
    try check(streamingRepeated == nil && streamingAfterRepeated.count == 2,
      "Repeated delivery of the accepted fix cannot create a duplicate recovery receipt")

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
      _ = try restarted.observeAccessLoss(reason: "services-disabled", at: 40_000)
      throw TestFailure.assertion("Corruption must not create an access-loss episode")
    } catch is TestFailure { throw TestFailure.assertion("Corruption must not create an access-loss episode") }
    catch { checks += 1 }
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

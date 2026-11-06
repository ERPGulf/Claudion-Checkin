import Foundation
import UIKit

/// A bounded assertion for native location/push wakes, independent of whether
/// React Native already owns a scene/root. It is not an upload scheduler.
final class AttendanceBackgroundSync {
  static let shared = AttendanceBackgroundSync()
  private let state = AttendanceBackgroundSyncState()
  private let budgetMs: Int64 = 25_000
  private let observerLock = NSLock()
  private var pushObserver: NSObjectProtocol?
  @MainActor private var assertions: [String: UIBackgroundTaskIdentifier] = [:]
  @MainActor private var deadlines: [String: DispatchWorkItem] = [:]

  private init() {}

  private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  /// Register before protected-storage reads/JS startup. Observe RNFirebase's
  /// existing wake notification without taking its delegate/completion handler
  /// or retaining remote-message payloads. A push is execution, not attendance.
  func observeBackgroundPushes() {
    observerLock.lock()
    defer { observerLock.unlock() }
    guard pushObserver == nil else { return }
    pushObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("RNFBMessagingDidReceiveRemoteNotification"), object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.requestOnMain(reason: "push") }
    }
  }

  /// Forward the original persisted receipt only after the assertion is set up.
  /// UIKit calls stay on main; synchronous JS ownership queries use the lock.
  func captured(_ event: [String: Any?], deliver: @escaping () -> Void) {
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        self.captureOnMain(event)
        deliver()
      }
    } else {
      DispatchQueue.main.async {
        self.captureOnMain(event)
        deliver()
      }
    }
  }

  @MainActor private func captureOnMain(_ event: [String: Any?]) {
    AttendanceBackgroundSyncDiagnostics.record("ios.native.persisted", eventId: event["eventId"] as? String,
      details: ["capturedAt": event["timestamp"] ?? nil, "sequence": event["sequence"] ?? nil])
    requestOnMain(reason: "location", eventId: event["eventId"] as? String)
  }

  @MainActor private func requestOnMain(reason: String, eventId: String? = nil) {
    guard UIApplication.shared.applicationState != .active else { return }
    let capturedAt = now()
    if let expired = state.expireIfDue(now: capturedAt) { expireOnMain(expired, reason: "deadline") }
    let (run, created) = state.request(now: capturedAt, budgetMs: budgetMs)
    if created {
      let task = UIApplication.shared.beginBackgroundTask(withName: "Attendance background wake") {
        // UIKit calls this on main and requires the assertion to end before it
        // returns; a queued end lets iOS terminate the app instead of suspending it.
        MainActor.assumeIsolated { self.expire(run.runId, reason: "system-expiration") }
      }
      guard task != .invalid else {
        expire(run.runId, reason: "assertion-unavailable")
        return
      }
      assertions[run.runId] = task
      let timeout = DispatchWorkItem { [weak self] in self?.expire(run.runId, reason: "deadline") }
      deadlines[run.runId] = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(budgetMs) / 1000, execute: timeout)
    }
    guard state.isActive(run.runId, now: now()) else {
      endAssertion(run.runId)
      return
    }
    AttendanceBackgroundSyncDiagnostics.record(created ? "ios.wake.started" : "ios.wake.coalesced",
      eventId: eventId, details: run.payload.merging(["reason": reason]) { _, next in next })
    GeofenceEventBus.shared.emitBackgroundSync(GeofenceEvents.backgroundSyncRequested, run.payload)
  }

  func pending() -> [String: Any]? { state.pending(now: now())?.payload }

  func isActive(_ runId: String) -> Bool { state.isActive(runId, now: now()) }

  func complete(_ runId: String, revision: Int, retry: Bool) -> Bool {
    guard let run = state.complete(runId, revision: revision, now: now()) else { return false }
    AttendanceBackgroundSyncDiagnostics.record("ios.wake.completed", details: run.payload.merging(["retryable": retry]) { _, next in next })
    DispatchQueue.main.async { self.endAssertion(run.runId) }
    return true
  }

  @MainActor private func expire(_ runId: String, reason: String) {
    guard let run = state.expire(runId) else {
      // Completion already released ownership but queued its end; end it now.
      endAssertion(runId)
      return
    }
    expireOnMain(run, reason: reason)
  }

  @MainActor private func expireOnMain(_ run: AttendanceBackgroundSyncState.Run, reason: String) {
    // Ownership is already invalid before JS receives expiration. A delayed
    // continuation must fail its active-run boundary, even if the event is late.
    endAssertion(run.runId)
    AttendanceBackgroundSyncDiagnostics.record("ios.wake.expired", details: run.payload.merging(["reason": reason]) { _, next in next })
    GeofenceEventBus.shared.emitBackgroundSync(GeofenceEvents.backgroundSyncExpired, run.payload)
  }

  @MainActor private func endAssertion(_ runId: String) {
    deadlines.removeValue(forKey: runId)?.cancel()
    guard let task = assertions.removeValue(forKey: runId) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }
}

/// Bounded DEBUG evidence only. Never retain tenant/employee identifiers,
/// credentials, geometry, payloads, responses or free-form error text.
enum AttendanceBackgroundSyncDiagnostics {
  private static let lock = NSRecursiveLock()
  private static let key = "expoAutoAttendance.backgroundSyncDiagnostics"
  private static let retentionMs: Int64 = 7 * 24 * 60 * 60 * 1000
  private static let capacity = 200
  private static let numeric = Set(["capturedAt", "sequence", "revision", "deadline", "timestamp", "occurredAt", "queueRowId", "httpStatus", "attempt", "attemptAt", "nextAttemptAt", "durationMs", "count"])
  private static let booleans = Set(["retryable", "retry", "networkAvailable", "serverReachable"])
  private static let labels = Set(["status", "reason", "appState", "transition"])

  private static func label(_ value: String) -> Bool {
    value.range(of: "^[a-zA-Z0-9_.:-]{1,80}$", options: .regularExpression) != nil
  }

  static func record(_ stage: String, eventId: String? = nil, details: [String: Any?] = [:]) {
#if DEBUG
    guard label(stage) else { return }
    lock.lock()
    defer { lock.unlock() }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    var entry: [String: Any] = ["stage": stage, "at": now]
    if let eventId, UUID(uuidString: eventId) != nil { entry["eventId"] = eventId }
    if let runId = details["runId"] as? String, UUID(uuidString: runId) != nil { entry["runId"] = runId }
    for (key, value) in details {
      if numeric.contains(key), let number = value as? NSNumber, number.doubleValue.isFinite { entry[key] = number }
      else if booleans.contains(key), let boolean = value as? Bool { entry[key] = boolean }
      else if labels.contains(key), let value = value as? String, label(value) { entry[key] = value }
    }
    var retained = read(now: now)
    retained.append(entry)
    UserDefaults.standard.set(Array(retained.suffix(capacity)), forKey: key)
    NSLog("[AttendanceSync] %@", entry as NSDictionary)
#endif
  }

  private static func read(now: Int64) -> [[String: Any]] {
    return (UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []).filter {
      guard let at = ($0["at"] as? NSNumber)?.int64Value else { return false }
      return at >= now - retentionMs && at <= now
    }
  }

  static func entries() -> [[String: Any]] {
#if DEBUG
    lock.lock()
    defer { lock.unlock() }
    return read(now: Int64(Date().timeIntervalSince1970 * 1000))
#else
    return []
#endif
  }
}

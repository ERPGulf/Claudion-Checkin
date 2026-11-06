import Foundation
import Dispatch
import UIKit

@main
struct CoordinatorHarness {
  @MainActor static func main() async {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) {
      checks += 1
      if !condition() { fatalError(message) }
    }
    func settleMainQueue() async {
      await withCheckedContinuation { continuation in
        DispatchQueue.main.async { continuation.resume() }
      }
    }
    func push() {
      // A remote payload is deliberately ignored, never forwarded to attendance.
      NotificationCenter.default.post(name: Notification.Name("RNFBMessagingDidReceiveRemoteNotification"),
        object: nil, userInfo: ["body": "synthetic-private-message"])
    }

    let application = UIApplication.shared
    let coordinator = AttendanceBackgroundSync.shared
    var emitted: [(String, [String: Any?])] = []
    GeofenceEventBus.shared.listener = { name, payload in emitted.append((name, payload)) }
    coordinator.observeBackgroundPushes()
    coordinator.observeBackgroundPushes()
    check(coordinator.pending() == nil, "observer installation must not create work")

    push()
    let first = coordinator.pending()!
    let firstId = first["runId"] as! String
    check(application.beginCount == 1, "cold push must acquire exactly one assertion")
    check(emitted.count == 1 && emitted.last?.0 == GeofenceEvents.backgroundSyncRequested,
      "push requests execution without emitting a location/attendance receipt")
    check(Set(emitted.last!.1.keys) == Set(["runId", "revision", "deadline"]),
      "remote message payload must not enter wake events")
    check(coordinator.complete(firstId, revision: 1, retry: true), "push pass may finish with retained queue work")
    await settleMainQueue()
    check(application.endCount == 1, "completed execution releases its assertion")

    push()
    let warm = coordinator.pending()!
    let warmId = warm["runId"] as! String
    check(warmId != firstId && application.beginCount == 2, "subsequent warm push gets a fresh bounded run")
    var delivered = 0
    coordinator.captured(["eventId": UUID().uuidString, "timestamp": Int64(Date().timeIntervalSince1970 * 1000)]) {
      delivered += 1
    }
    check(delivered == 1, "location receipt hint is preserved")
    check(coordinator.pending()?["revision"] as? Int == 2 && application.beginCount == 2,
      "location and push share one assertion and revision sequence")
    push()
    check(coordinator.pending()?["revision"] as? Int == 3 && application.beginCount == 2,
      "another push coalesces without duplicate observers or extra assertions")
    check(coordinator.pending()?["deadline"] as? Int64 == warm["deadline"] as? Int64,
      "pushes must not extend the burst cap")
    check(!coordinator.complete(warmId, revision: 1, retry: false), "stale push completion must not lose location work")

    let oldExpiration = application.handlers[application.latest]!
    oldExpiration()
    check(!coordinator.isActive(warmId) && coordinator.pending() == nil,
      "OS expiration invalidates ownership synchronously before queued notification")
    check(application.endCount == 2 && emitted.last?.0 == GeofenceEvents.backgroundSyncExpired,
      "OS expiration ends the assertion before its handler returns")

    push()
    let recovered = coordinator.pending()!
    let recoveredId = recovered["runId"] as! String
    check(recoveredId != warmId && application.beginCount == 3, "a later eligible push resumes after expiration")
    oldExpiration()
    check(coordinator.isActive(recoveredId), "old expiration cannot cancel later push execution")
    check(!coordinator.complete(warmId, revision: 3, retry: false), "old completion cannot release later push")
    check(coordinator.complete(recoveredId, revision: 1, retry: false), "current push completion succeeds")
    // Expiration racing a completion whose end is still queued must not leave it held.
    application.handlers[application.latest]!()
    check(application.endCount == 3, "expiration after completion ends the assertion synchronously")
    await settleMainQueue()
    check(application.endCount == 3, "queued completion end does not double-end the assertion")

    application.applicationState = .active
    push()
    check(coordinator.pending() == nil && application.beginCount == 3,
      "foreground push leaves execution to normal foreground machinery")
    application.applicationState = .background
    application.refuseNextAssertion = true
    push()
    check(coordinator.pending() == nil && emitted.last?.0 == GeofenceEvents.backgroundSyncExpired,
      "refused assertion retains no live execution scope")
    check(delivered == 1 && emitted.allSatisfy { [GeofenceEvents.backgroundSyncRequested, GeofenceEvents.backgroundSyncExpired].contains($0.0) },
      "push coordination never manufactures attendance or a geofence event")
    print("Attendance background wake coordinator: \(checks) assertions passed")
  }
}

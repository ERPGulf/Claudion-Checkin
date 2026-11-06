import Foundation
import Dispatch

// Executes the production ownership state machine, not a copied test model.
// UIKit scheduling/delivery still requires the native build/device matrix.
var assertions = 0
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  assertions += 1
  if !condition() { fatalError(message) }
}

let state = AttendanceBackgroundSyncState()
let (first, created) = state.request(now: 1_000, budgetMs: 25_000, newId: { "first" })
check(created, "first native wake must acquire ownership")
check(first.revision == 1 && first.deadline == 26_000, "first wake has a bounded cap")
check(state.pending(now: 1_000)?.runId == first.runId, "cold wake remains latched before JS subscribes")

let (secondCapture, secondCreated) = state.request(now: 2_000, budgetMs: 25_000, newId: { "unused" })
check(!secondCreated, "an active burst must coalesce")
check(secondCapture.runId == first.runId && secondCapture.revision == 2, "capture increments revision")
check(secondCapture.deadline == first.deadline, "capture must not extend a lease")
check(state.complete(first.runId, revision: first.revision, now: 3_000) == nil,
  "an earlier drain must not consume a later capture")
check(state.isActive(first.runId, now: 3_000), "stale completion must retain execution ownership")
check(state.complete(first.runId, revision: secondCapture.revision, now: 3_000) != nil,
  "a drain that observed every capture may release ownership")
check(state.pending(now: 3_000) == nil, "completed execution must no longer be pending")

let (warm, warmCreated) = state.request(now: 4_000, budgetMs: 25_000, newId: { "warm" })
check(warmCreated && warm.runId != first.runId, "later warm callback gets a new execution run")
check(state.complete(first.runId, revision: 2, now: 5_000) == nil,
  "late JS completion must not release the warm run")
check(state.expire(first.runId) == nil, "old timer must not expire a newer run")
check(state.isActive(warm.runId, now: 5_000), "warm ownership survives old callbacks")
check(state.expire(warm.runId)?.runId == warm.runId, "OS expiration releases its own run")
check(!state.isActive(warm.runId, now: 5_000), "expiration invalidates ownership before JS notification")
check(state.complete(warm.runId, revision: warm.revision, now: 5_000) == nil,
  "expired continuation cannot acknowledge execution")

let (deadlineRun, _) = state.request(now: 6_000, budgetMs: 1_000, newId: { "deadline" })
check(state.isActive(deadlineRun.runId, now: 6_999), "ownership lasts only until its cap")
check(!state.isActive(deadlineRun.runId, now: 7_000), "delayed timer cannot extend ownership")
check(state.pending(now: 7_000) == nil, "deadline passed while suspended is not pending work")
check(state.complete(deadlineRun.runId, revision: 1, now: 7_000) == nil,
  "completion after deadline must fail")
check(state.expireIfDue(now: 7_000)?.runId == deadlineRun.runId, "next callback retires overdue ownership")
check(state.expireIfDue(now: 7_000) == nil, "expiration is idempotent")

let concurrent = AttendanceBackgroundSyncState()
DispatchQueue.concurrentPerform(iterations: 100) { _ in
  _ = concurrent.request(now: 8_000, budgetMs: 25_000)
}
check(concurrent.pending(now: 8_000)?.revision == 100,
  "concurrent sync queries and native captures must not lose revisions")
let concurrentRun = concurrent.pending(now: 8_000)!
check(concurrent.complete(concurrentRun.runId, revision: 100, now: 8_001) != nil,
  "latest concurrent revision is completable exactly once")
check(concurrent.complete(concurrentRun.runId, revision: 100, now: 8_001) == nil,
  "execution completion is idempotent")

print("Attendance background wake state: \(assertions) assertions passed")

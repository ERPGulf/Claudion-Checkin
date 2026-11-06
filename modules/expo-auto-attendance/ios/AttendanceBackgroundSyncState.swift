import Foundation

/// In-memory execution ownership only. Attendance remains in the native journal
/// and existing SQLite tables; expiration never acknowledges or changes it.
final class AttendanceBackgroundSyncState: @unchecked Sendable {
  struct Run {
    let runId: String
    var revision: Int
    let deadline: Int64

    var payload: [String: Any] {
      return ["runId": runId, "revision": revision, "deadline": deadline]
    }
  }

  private let lock = NSLock()
  private var current: Run?

  private func locked<T>(_ operation: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return operation()
  }

  func request(now: Int64, budgetMs: Int64, newId: () -> String = { UUID().uuidString }) -> (Run, Bool) {
    return locked {
      if var run = current, run.deadline > now {
        run.revision += 1
        current = run
        return (run, false)
      }
      let run = Run(runId: newId(), revision: 1, deadline: now + budgetMs)
      current = run
      return (run, true)
    }
  }

  func pending(now: Int64) -> Run? {
    return locked { current.flatMap { $0.deadline > now ? $0 : nil } }
  }

  func isActive(_ runId: String, now: Int64) -> Bool {
    return locked { current?.runId == runId && (current?.deadline ?? 0) > now }
  }

  /// A capture that arrived while JS drained increments the revision. Only a
  /// pass that saw that revision can release the assertion for the burst.
  func complete(_ runId: String, revision: Int, now: Int64) -> Run? {
    return locked {
      guard let run = current, run.runId == runId, run.revision == revision,
        run.deadline > now else { return nil }
      current = nil
      return run
    }
  }

  func expire(_ runId: String) -> Run? {
    return locked {
      guard let run = current, run.runId == runId else { return nil }
      current = nil
      return run
    }
  }

  func expireIfDue(now: Int64) -> Run? {
    return locked {
      guard let run = current, run.deadline <= now else { return nil }
      current = nil
      return run
    }
  }
}

import Foundation

// Minimal host-only UIKit surface for executing the production wake coordinator.
// It is compiled as a separate test module, never included by the podspec.
public struct UIBackgroundTaskIdentifier: Hashable, Sendable {
  public let rawValue: Int
  public static let invalid = UIBackgroundTaskIdentifier(rawValue: 0)
}

@MainActor public final class UIApplication {
  public enum State { case active, inactive, background }
  public static let shared = UIApplication()
  public var applicationState = State.background
  public var refuseNextAssertion = false
  public private(set) var beginCount = 0
  public private(set) var endCount = 0
  public private(set) var handlers: [UIBackgroundTaskIdentifier: () -> Void] = [:]
  public private(set) var latest = UIBackgroundTaskIdentifier.invalid

  public func beginBackgroundTask(withName: String?, expirationHandler: @escaping () -> Void) -> UIBackgroundTaskIdentifier {
    beginCount += 1
    if refuseNextAssertion {
      refuseNextAssertion = false
      return .invalid
    }
    let identifier = UIBackgroundTaskIdentifier(rawValue: beginCount)
    handlers[identifier] = expirationHandler
    latest = identifier
    return identifier
  }

  public func endBackgroundTask(_ identifier: UIBackgroundTaskIdentifier) {
    if handlers.removeValue(forKey: identifier) != nil { endCount += 1 }
  }
}

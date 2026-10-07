internal import Expo
internal import EXUpdates
import React
import UIKit

/// A location/FCM wake can launch the process without connecting a scene. Keep
/// the existing App (hydration, attendance replay and FCM handler) running in
/// that case, using the same Updates-selected bundle as a foreground launch.
@MainActor
final class AttendanceBackgroundRuntime: NSObject, AppControllerDelegate {
  static let shared = AttendanceBackgroundRuntime()

  private weak var factory: ExpoReactNativeFactory?
  private var launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  private var observers: [NSObjectProtocol] = []
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private weak var connectedWindow: UIWindow?
  private(set) var hasStarted = false
  private var rootView: UIView?

  func configure(
    factory: ExpoReactNativeFactory,
    launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) {
    self.factory = factory
    self.launchOptions = launchOptions
    guard observers.isEmpty else { return }
    // The RNFirebase name is emitted before its background-handler wait. This
    // adapter observes it without taking over its delegate/completion handler.
    for name in ["ClaudionGeofenceTransition", "RNFBMessagingDidReceiveRemoteNotification"] {
      observers.append(NotificationCenter.default.addObserver(
        forName: Notification.Name(name), object: nil, queue: .main
      ) { _ in
        Task { @MainActor in AttendanceBackgroundRuntime.shared.startIfNeeded() }
      })
    }
#if DEBUG
    // Simulator regression probe, excluded from release builds. It exercises a
    // windowless startup followed by scene connection without a live tenant.
    if ProcessInfo.processInfo.environment["CLAUDION_TEST_BACKGROUND_STARTUP"] == "1" {
      startIfNeeded(simulateWake: true)
    }
#endif
  }

  private func startIfNeeded(simulateWake: Bool = false) {
    let application = UIApplication.shared
    guard !hasStarted, let factory else { return }
    let provider = application.delegate as? ExpoReactNativeFactoryProvider
    guard simulateWake || (
      application.applicationState == .background && application.connectedScenes.isEmpty && provider?.window == nil
    ) else { return }
    hasStarted = true
    backgroundTask = application.beginBackgroundTask(withName: "Attendance JS startup") {
      Task { @MainActor in AttendanceBackgroundRuntime.shared.endBackgroundTask() }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
      self?.endBackgroundTask()
    }
    AppController.initializeWithoutStarting()
    let controller = AppController.sharedInstance
    if controller.isActiveController {
      controller.delegate = self
      if controller.isStarted, let bundleURL = controller.launchAssetUrl() {
        createRootView(bundleURL: bundleURL)
      } else if !controller.isStarted {
        controller.start()
      }
    } else {
      // Debug uses Metro; disabled Updates uses the embedded bundle.
      createRootView(bundleURL: factory.delegate?.bundleURL())
    }
  }

  nonisolated func appController(_ appController: AppControllerInterface, didStartWithSuccess success: Bool) {
    let bundleURL = appController.launchAssetUrl()
    Task { @MainActor [weak self] in self?.createRootView(bundleURL: bundleURL) }
  }

  private func createRootView(bundleURL: URL?) {
    guard rootView == nil, let factory else { return }
    // The public factory method skips Updates' window-owning view handler.
    // Selection/startup above still runs through the original AppController.
    let view = factory.recreateRootView(
      withBundleURL: bundleURL, moduleName: "main", initialProps: nil,
      launchOptions: launchOptions
    )
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    rootView = view
    if let connectedWindow { attach(to: connectedWindow) }
    NSLog("[AttendanceRuntime] Background React root started")
  }

  func attach(to window: UIWindow) {
    connectedWindow = window
    let controller = window.rootViewController ?? UIViewController()
    if let rootView {
      controller.view = rootView
    } else if window.rootViewController == nil {
      controller.view.backgroundColor = .systemBackground
    }
    window.rootViewController = controller
    window.makeKeyAndVisible()
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }
}

/// Only changes connection after a windowless wake: reuse the existing root,
/// rather than mount App twice. All other scene callbacks remain Expo's own.
@objc(ClaudionAttendanceSceneDelegate)
final class AttendanceSceneDelegate: ExpoAppSceneDelegate {
  override func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    let runtime = AttendanceBackgroundRuntime.shared
    guard runtime.hasStarted else {
      super.scene(scene, willConnectTo: session, options: connectionOptions)
      return
    }
    guard let windowScene = scene as? UIWindowScene,
      let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    provider.window = window
    runtime.attach(to: window)
    NSLog("[AttendanceRuntime] Reusing background React root for scene")
    // Use inherited Expo forwarding for links/activities/quick actions; never
    // dispatch UIKit lifecycle notifications or AppDelegate hooks a second time.
    self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
#if os(iOS)
    if let shortcut = connectionOptions.shortcutItem {
      self.windowScene(windowScene, performActionFor: shortcut) { _ in }
    }
#endif
  }
}

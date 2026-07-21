import ExpoModulesCore
import UIKit

/**
 Registered via `expo-module.config.json` (`apple.appDelegateSubscribers`).

 When iOS relaunches the app in the background because a monitored region was
 crossed (after a reboot, memory eviction, or user termination), the geofence
 event is only delivered if a `CLLocationManager` with a delegate exists. This
 subscriber primes `GeofenceManager` at launch — before JS loads — so the
 transition is captured, logged, and persisted for later display in the app.
 */
public class AutoAttendanceAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if GeofenceStore.shared.isMonitoring {
      GeofenceManager.shared.primeOnLaunch()
    }
    return true
  }
}

import ExpoModulesCore
import UIKit

/**
 Registered via `expo-module.config.json` (`apple.appDelegateSubscribers`).

 When iOS relaunches the app in the background because a monitored region was
 crossed in an OS-supported state, the geofence
 event is only delivered if a `CLLocationManager` with a delegate exists. This
 subscriber primes `GeofenceManager` at launch — before JS loads — so the
 transition is captured and journaled before JavaScript starts. This does not
 guarantee delivery after explicit force-quit or under OS execution restrictions.
 */
public class AutoAttendanceAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    do {
      let registration = try GeofenceStore.shared.getRegistrationState()
      if launchOptions?[.location] != nil || ["pending", "monitoring"].contains(registration?["status"] as? String ?? "") {
        GeofenceManager.shared.primeOnLaunch()
      }
    } catch {
      // Attach the delegate even when protected/corrupt storage is unavailable;
      // recovery fails explicitly and cannot assign a callback to another owner.
      GeofenceManager.shared.primeOnLaunch()
    }
    return true
  }
}

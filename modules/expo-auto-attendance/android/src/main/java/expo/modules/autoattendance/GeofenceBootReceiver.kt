package expo.modules.autoattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Re-registers the persisted geofence after the events that make Android drop
 * registered geofences: device reboot and app update. Without this, monitoring
 * would silently stop until the user reopened the app and pressed Start again.
 */
class GeofenceBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
      return
    }
    Log.i(GeofenceManager.TAG, "System broadcast $action received, restoring geofence")
    GeofenceManager.restoreFromStore(context)
  }
}

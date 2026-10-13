package expo.modules.autoattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

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
    val result = goAsync()
    val finished = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    val timeout = Runnable {
      if (finished.compareAndSet(false, true)) {
        Log.w(GeofenceManager.TAG, "Geofence restore exceeded broadcast budget")
        result.finish()
      }
    }
    handler.postDelayed(timeout, 8000L)
    try {
      GeofenceManager.restoreFromStore(context) {
        handler.removeCallbacks(timeout)
        if (finished.compareAndSet(false, true)) result.finish()
      }
    } catch (error: Exception) {
      handler.removeCallbacks(timeout)
      if (finished.compareAndSet(false, true)) result.finish()
      Log.e(GeofenceManager.TAG, "Geofence restore failed")
    }
  }
}

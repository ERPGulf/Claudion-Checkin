package expo.modules.autoattendance

import android.content.Context

object GeofenceManager { const val TAG = "ExpoAutoAttendance" }

/** JVM capture tests substitute only the Android scheduling boundary. */
object GeofenceCaptureQueue {
  val persisted = mutableListOf<Map<String, Any?>>()
  fun onPersisted(context: Context, event: Map<String, Any?>) {
    check(GeofenceStore.getPendingEvents(Context(context.directory)).any { it["eventId"] == event["eventId"] })
    persisted.add(event)
  }
}

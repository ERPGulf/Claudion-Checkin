package expo.modules.autoattendance

/**
 * In-process bridge between [GeofenceBroadcastReceiver] (which runs outside the
 * React Native context, possibly with no JS loaded at all) and
 * [ExpoAutoAttendanceModule] (which forwards events to JS listeners).
 *
 * The receiver persists every event via [GeofenceStore] before emitting, so nothing
 * is lost when the app process was woken up just for the broadcast and no listener
 * is attached.
 */
object GeofenceEventBus {
  fun interface Listener {
    fun onEvent(eventName: String, payload: Map<String, Any?>)
  }

  @Volatile
  private var listener: Listener? = null

  fun attach(listener: Listener) {
    this.listener = listener
  }

  fun detach() {
    listener = null
  }

  fun emit(eventName: String, payload: Map<String, Any?>) {
    listener?.onEvent(eventName, payload)
  }
}

package expo.modules.autoattendance

/**
 * In-process bridge between [GeofenceBroadcastReceiver] (which runs outside the
 * React Native context, possibly with no JS loaded at all) and
 * [ExpoAutoAttendanceModule] (which forwards events to JS listeners).
 *
 * The receiver journals each capture before emitting. A missing listener only
 * drops this live hint; the unacknowledged capture remains available for replay.
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

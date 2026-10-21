package expo.modules.autoattendance

import java.util.UUID

/**
 * A delivery journal, not a second attendance queue. The host copies captures to
 * its SQLite ingress before acknowledging an exact event ID. There is no age or
 * size eviction: captures remain here while JavaScript is unavailable.
 *
 * Storage must synchronously persist each replacement or throw. Reads always use
 * storage, so a failed write is never treated as an acknowledged capture.
 */
class GeofenceEventJournal(
  private val readState: () -> State,
  private val writeState: (State) -> Unit,
  private val readLegacyEvent: () -> Map<String, Any?>?,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  data class State(
    val nextSequence: Long = 0,
    val legacyMigrated: Boolean = false,
    val events: List<Map<String, Any?>> = emptyList(),
  )

  private fun stateAfterMigration(): State {
    val previous = readState()
    if (previous.legacyMigrated) return previous
    val legacy = readLegacyEvent()
    val migrated = if (legacy == null) {
      previous.copy(legacyMigrated = true)
    } else {
      val sequence = previous.nextSequence + 1
      val event = legacy + mapOf(
        "eventId" to newId(),
        "sequence" to sequence,
        "captureIssue" to "legacy-unattributed",
        "tenantKey" to null,
        "employeeId" to null,
        "registrationId" to null,
        "geotagging" to null,
      )
      previous.copy(
        nextSequence = sequence,
        legacyMigrated = true,
        events = previous.events + event,
      )
    }
    writeState(migrated)
    return migrated
  }

  @Synchronized
  fun append(capture: Map<String, Any?>): Map<String, Any?> {
    val previous = stateAfterMigration()
    val sequence = previous.nextSequence + 1
    val event = capture + mapOf("eventId" to newId(), "sequence" to sequence)
    writeState(previous.copy(nextSequence = sequence, events = previous.events + event))
    return event
  }

  @Synchronized
  fun pending(): List<Map<String, Any?>> = stateAfterMigration().events

  @Synchronized
  fun acknowledge(eventId: String): Boolean {
    val previous = stateAfterMigration()
    if (previous.events.none { it["eventId"] == eventId }) return false
    writeState(previous.copy(events = previous.events.filterNot { it["eventId"] == eventId }))
    return true
  }
}

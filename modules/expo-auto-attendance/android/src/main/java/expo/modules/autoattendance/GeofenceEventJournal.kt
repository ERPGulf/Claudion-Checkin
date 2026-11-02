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
    val accessEpisode: Map<String, Any?>? = null,
    val recoveryBarrier: Map<String, Any?>? = null,
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
    val clearBarrier = capture["transition"] == "EXIT" && capture["captureIssue"] == null &&
      previous.accessEpisode == null && previous.recoveryBarrier?.get("registrationGeneration") == capture["registrationGeneration"]
    writeState(previous.copy(nextSequence = sequence, events = previous.events + event,
      recoveryBarrier = if (clearBarrier) null else previous.recoveryBarrier))
    return event
  }

  @Synchronized
  fun pending(): List<Map<String, Any?>> = stateAfterMigration().events

  @Synchronized
  fun accessEpisode(): Map<String, Any?>? = stateAfterMigration().accessEpisode

  @Synchronized
  fun captureBarrier(): Map<String, Any?>? = stateAfterMigration().let {
    it.accessEpisode ?: it.recoveryBarrier?.takeUnless { barrier -> barrier["presence"] == "outside" }
  }

  /** Even after outside proof, a repaired registration must not synthesize ENTER. */
  @Synchronized
  fun suppressInitialEnter(): Boolean = stateAfterMigration().let {
    it.accessEpisode != null || it.recoveryBarrier != null
  }

  /** Capture and deduplication marker share one commit, including across restart. */
  @Synchronized
  fun recordAccessLoss(metadata: Map<String, Any?>, reason: String, at: Long): Map<String, Any?>? {
    val previous = stateAfterMigration()
    if (previous.accessEpisode != null) return null
    val event = metadata + mapOf(
      "kind" to "LOCATION_ACCESS_LOST", "reason" to reason, "timestamp" to at,
      "eventId" to newId(), "sequence" to previous.nextSequence + 1,
    )
    val episode = metadata + mapOf("lossEventId" to event["eventId"], "firstObservedAt" to at)
    writeState(previous.copy(nextSequence = previous.nextSequence + 1,
      events = previous.events + event, accessEpisode = episode, recoveryBarrier = null))
    return event
  }

  @Synchronized
  fun completeAccessRecovery(lossEventId: String, generation: String, proof: Map<String, Any?>): Map<String, Any?>? {
    val previous = stateAfterMigration()
    val episode = previous.accessEpisode ?: return null
    if (episode["lossEventId"] != lossEventId || episode["registrationGeneration"] != generation) return null
    val lossAt = (episode["firstObservedAt"] as? Number)?.toLong() ?: return null
    val requestedAt = (proof["fixRequestedAt"] as? Number)?.toLong() ?: return null
    val observedAt = (proof["timestamp"] as? Number)?.toLong() ?: return null
    // A backward device-clock change cannot invent a pre-loss recovery time.
    if (requestedAt < lossAt || observedAt < requestedAt) return null
    val metadata = episode - setOf("lossEventId", "firstObservedAt")
    val event = metadata + proof + mapOf("kind" to "LOCATION_ACCESS_RECOVERED", "lossEventId" to lossEventId,
      "eventId" to newId(), "sequence" to previous.nextSequence + 1)
    writeState(previous.copy(nextSequence = previous.nextSequence + 1,
      events = previous.events + event, accessEpisode = null,
      recoveryBarrier = episode + mapOf("presence" to proof["presence"])))
    return event
  }

  @Synchronized
  fun cancelAccessEpisode() {
    val previous = stateAfterMigration()
    if (previous.accessEpisode != null || previous.recoveryBarrier != null) {
      writeState(previous.copy(accessEpisode = null, recoveryBarrier = null))
    }
  }

  @Synchronized
  fun acknowledge(eventId: String): Boolean {
    val previous = stateAfterMigration()
    if (previous.events.none { it["eventId"] == eventId }) return false
    writeState(previous.copy(events = previous.events.filterNot { it["eventId"] == eventId }))
    return true
  }
}

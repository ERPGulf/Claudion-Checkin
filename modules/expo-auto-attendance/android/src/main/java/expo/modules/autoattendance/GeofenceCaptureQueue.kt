package expo.modules.autoattendance

import android.content.Context
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** One capture order for crossings, access observations, and recovery proofs. */
object GeofenceCaptureQueue {
  private var captureThread: Thread? = null
  private val executor = Executors.newSingleThreadExecutor { operation ->
    Thread(operation, "attendance-native-capture").also { captureThread = it }
  }

  fun execute(operation: () -> Unit) { executor.execute(operation) }

  /** A scheduling failure never rolls back an already durable native capture. */
  fun onPersisted(context: Context, event: Map<String, Any?>) {
    val eventId = event["eventId"] as? String
    AttendanceSyncDiagnostics.record(context, "native.persisted", eventId, mapOf(
      "capturedAt" to event["timestamp"], "sequence" to event["sequence"],
      "transition" to event["transition"],
    ))
    runCatching { AttendanceSyncScheduler.schedule(context, eventId, awaitCommit = true) }.onFailure {
      AttendanceSyncDiagnostics.record(context, "worker.schedule_failed", eventId)
    }
  }

  fun <T> sync(operation: () -> T): T = if (Thread.currentThread() === captureThread) operation()
    else executor.submit(Callable { operation() }).get()
}

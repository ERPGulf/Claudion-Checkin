package expo.modules.autoattendance

import android.content.Context
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Serialized, network-constrained passes through the existing JS processor; all
 * HTTP stays in JS. Passes never use WorkManager's Result.retry(): a chain in
 * backoff holds every work appended behind it, so a new crossing would wait for
 * an older record's retry delay. Retry is a separate timer that only asks for a
 * pass, so replacing it can never cancel an upload or start a second processor.
 */
object AttendanceSyncScheduler {
  private const val WORK_NAME = "claudion-attendance-sync"
  private const val RETRY_NAME = "claudion-attendance-sync-retry"
  private const val PREFS = "attendance_sync_scheduler"
  private const val STREAK = "retryStreak"
  // Consecutive passes that left actionable work. New captures do not wait for
  // this ladder; it only paces retries of records that are already stuck.
  // ponytail: fixed ladder; use the queue's own nextAttemptAt if passes over a
  // long-stuck blocked row cost too much battery.
  private val RETRY_DELAYS_SECONDS = longArrayOf(30, 60, 120, 300, 900)
  // One decision at a time, so concurrent captures coalesce into one pass.
  private val decisions = Executors.newSingleThreadExecutor()

  fun schedule(context: Context, eventId: String? = null, awaitCommit: Boolean = false) {
    val application = context.applicationContext
    val decision = decisions.submit(Callable { enqueuePass(application, eventId) })
    // Native receivers keep goAsync alive through this durable WM transaction.
    // The receipt remains in the native journal even if scheduling times out.
    if (awaitCommit) decision.get(5, TimeUnit.SECONDS)
  }

  private fun enqueuePass(context: Context, eventId: String?) {
    try {
      val workManager = WorkManager.getInstance(context)
      // A pass that has not started yet scans after this already-durable capture.
      // A running pass may have scanned before it, so append one follow-up: the
      // chain runs it as soon as that pass ends, never concurrently with it.
      val states = workManager.getWorkInfosForUniqueWork(WORK_NAME).get().map { it.state }
      if (states.any { it == WorkInfo.State.ENQUEUED || it == WorkInfo.State.BLOCKED }) {
        AttendanceSyncDiagnostics.record(context, "worker.coalesced", eventId)
        return
      }
      // CONNECTED in WorkManager additionally requires Android's VALIDATED probe
      // on API26+. A reachable private tenant must not depend on that probe.
      // NetworkRequest constraints apply on API28+ (including Android11); older
      // Android falls back to the existing JS transport check and retry ladder.
      val constraints = Constraints.Builder().setRequiredNetworkRequest(
        NetworkRequest.Builder().clearCapabilities()
          .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
        NetworkType.NOT_REQUIRED,
      ).build()
      val request = OneTimeWorkRequestBuilder<AttendanceSyncWorker>()
        .setConstraints(constraints)
        // Only an OS interruption reschedules a pass; keep that delay short.
        .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
        .addTag(WORK_NAME)
        .build()
      workManager.enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request).result.get()
      AttendanceSyncDiagnostics.record(context, "worker.scheduled", eventId)
    } catch (error: Exception) {
      AttendanceSyncDiagnostics.record(context, "worker.schedule_failed", eventId)
      throw error
    }
  }

  /** Called by a finished pass. A failure here leaves the work for the next trigger. */
  fun onPassFinished(context: Context, retry: Boolean) {
    runCatching {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val workManager = WorkManager.getInstance(context)
      if (!retry) {
        prefs.edit().putInt(STREAK, 0).commit()
        workManager.cancelUniqueWork(RETRY_NAME).result.get(5, TimeUnit.SECONDS)
        return
      }
      val streak = prefs.getInt(STREAK, 0) + 1
      prefs.edit().putInt(STREAK, streak).commit()
      val delay = RETRY_DELAYS_SECONDS[minOf(streak, RETRY_DELAYS_SECONDS.size) - 1]
      workManager.enqueueUniqueWork(RETRY_NAME, ExistingWorkPolicy.REPLACE,
        OneTimeWorkRequestBuilder<AttendanceSyncRetryWorker>().setInitialDelay(delay, TimeUnit.SECONDS).build())
        .result.get(5, TimeUnit.SECONDS)
      AttendanceSyncDiagnostics.record(context, "worker.retry_scheduled",
        details = mapOf("count" to streak, "durationMs" to delay * 1000))
    }.onFailure {
      AttendanceSyncDiagnostics.record(context, "worker.retry_schedule_failed")
    }
  }
}

/** Timer only: never runs JS, so REPLACE on it can never cancel an upload. */
class AttendanceSyncRetryWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result =
    runCatching { AttendanceSyncScheduler.schedule(applicationContext, awaitCommit = true) }
      .fold({ Result.success() }, { Result.retry() })
}

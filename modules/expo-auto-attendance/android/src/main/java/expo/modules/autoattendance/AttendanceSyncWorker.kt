package expo.modules.autoattendance

import android.content.Context
import android.net.ConnectivityManager
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.UUID

/** Starts the application's shared ReactHost without mounting a UI or starting a service. */
class AttendanceSyncWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  // WorkRequest IDs survive retry. A timed-out old JS invocation must never be
  // able to acknowledge the next attempt of that same WorkRequest.
  private val runId = UUID.randomUUID().toString()
  private val finished = CountDownLatch(1)
  private val closed = AtomicBoolean(false)
  @Volatile private var retry = true
  private var host: ReactHost? = null
  private var instanceListener: ReactInstanceEventListener? = null
  private var tasks: HeadlessJsTaskContext? = null
  private var taskId: Int? = null
  private var taskListener: HeadlessJsTaskEventListener? = null

  override fun doWork(): Result {
    active[runId] = this
    @Suppress("DEPRECATION")
    val networkAvailable = runCatching {
      (applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
        ?.activeNetworkInfo?.isConnected
    }.getOrNull()
    AttendanceSyncDiagnostics.record(applicationContext, "worker.start", runId,
      mapOf("attempt" to runAttemptCount, "networkAvailable" to networkAvailable))
    try {
      UiThreadUtil.runOnUiThread {
        if (closed.get() || isStopped) return@runOnUiThread
        try {
          val application = applicationContext as? ReactApplication
            ?: error("Attendance runtime unavailable")
          val reactHost = application.reactHost ?: error("Attendance ReactHost unavailable")
          host = reactHost
          val listener = object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              reactHost.removeReactInstanceEventListener(this)
              instanceListener = null
              UiThreadUtil.runOnUiThread {
                try { startTask(context) } catch (_: Exception) { finish(true) }
              }
            }
          }
          instanceListener = listener
          reactHost.addReactInstanceEventListener(listener)
          val existing = reactHost.currentReactContext
          if (existing != null) {
            reactHost.removeReactInstanceEventListener(listener)
            instanceListener = null
            startTask(existing)
          } else reactHost.start()
        } catch (_: Exception) {
          finish(true)
        }
      }
      if (!finished.await(WORKER_BUDGET_SECONDS, TimeUnit.SECONDS)) {
        AttendanceSyncDiagnostics.record(applicationContext, "worker.timeout", runId)
        retry = true
      }
    } catch (_: InterruptedException) {
      retry = true
      Thread.currentThread().interrupt()
    } finally {
      cleanup()
    }
    AttendanceSyncDiagnostics.record(applicationContext, "worker.complete", runId,
      mapOf("retryable" to retry))
    // A stopped pass is rescheduled by WorkManager itself. Otherwise always
    // succeed: Result.retry() would park every capture appended behind this pass.
    if (!isStopped) AttendanceSyncScheduler.onPassFinished(applicationContext, retry)
    return Result.success()
  }

  private fun startTask(context: ReactContext) {
    UiThreadUtil.assertOnUiThread()
    if (closed.get() || isStopped || taskId != null) return
    val taskContext = HeadlessJsTaskContext.getInstance(context)
    tasks = taskContext
    val listener = object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(id: Int) = Unit
      override fun onHeadlessJsTaskFinish(id: Int) {
        // RN completion can also mean timeout or JS rejection. Only the explicit
        // completion bridge can declare the existing queue safely drained.
        if (id == taskId) finish(true)
      }
    }
    taskListener = listener
    taskContext.addTaskEventListener(listener)
    taskId = taskContext.startTask(HeadlessJsTaskConfig(
      TASK_KEY, Arguments.createMap().apply { putString("runId", runId) },
      HEADLESS_BUDGET_MS, true,
    ))
  }

  private fun finish(shouldRetry: Boolean): Boolean {
    synchronized(this) {
      if (closed.get() || finished.count == 0L) return false
      retry = shouldRetry
      finished.countDown()
      return true
    }
  }

  private fun cleanup() {
    closed.set(true)
    active.remove(runId, this)
    UiThreadUtil.runOnUiThread {
      instanceListener?.let { host?.removeReactInstanceEventListener(it) }
      instanceListener = null
      taskListener?.let { tasks?.removeTaskEventListener(it) }
      taskListener = null
      taskId?.let { if (tasks?.isTaskRunning(it) == true) tasks?.finishTask(it) }
      taskId = null
      tasks = null
      host = null
    }
  }

  override fun onStopped() {
    finish(true)
    cleanup()
    super.onStopped()
  }

  companion object {
    const val TASK_KEY = "ClaudionAttendanceSync"
    private const val WORKER_BUDGET_SECONDS = 150L
    private const val HEADLESS_BUDGET_MS = 140000L
    private val active = ConcurrentHashMap<String, AttendanceSyncWorker>()

    fun isRunning(): Boolean = active.isNotEmpty()

    fun complete(runId: String, retry: Boolean): Boolean {
      val worker = active[runId] ?: return false
      return worker.finish(retry)
    }
  }
}

// src/services/offline/AttendanceSyncService.js
import { PUSH_RESULT, pushCheckin } from "./AttendanceApi";
import { MAX_RETRIES } from "./AttendanceQueueRepository";
import {
  claimNextPending,
  countByStatus,
  markFailed,
  markRetry,
  markSynced,
  purgeSynced,
  releaseStuckSyncing,
} from "./AttendanceQueueRepository";
import { notifyQueueChanged } from "./AttendanceQueueService";
import { classifyAttendanceError, FAILURE_KIND } from "./attendanceErrors";
import { uploadQueuedPhoto } from "./attendancePhotoUpload";
import { fetchIsOnline } from "./NetworkListener";

/**
 * Draining the queue.
 *
 * One row at a time, oldest first, until there is nothing due or the network
 * gives out. FIFO is not cosmetic here: a check-out uploaded before its
 * check-in produces a session the backend cannot reconcile, so order is part of
 * correctness rather than tidiness.
 *
 * Three things guarantee a punch is never uploaded twice:
 *  1. the single-flight promise below, which stops two drains in this JS context,
 *  2. `claimNextPending`'s atomic claim, which stops two drains in *any* context
 *     racing for the same row (a background relaunch alongside the foreground app),
 *  3. the server's own duplicate detection, which catches the case neither can —
 *     a request that committed and then timed out, so the row still looks pending.
 *
 * (3) is why a duplicate is recorded as success rather than as an error: it is
 * the expected outcome of a retry that was always going to be redundant, not a
 * fault.
 */

const LOG_PREFIX = "[AttendanceSyncService]";

/** Stops one bad row from spinning the drain forever within a single pass. */
const MAX_ROWS_PER_RUN = 50;

/** Synced rows are kept this long so history can show them, then dropped. */
export const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The in-flight run, or null. Concurrency control — see (1) above. */
let activeRun = null;

/** Set once per app session, so stuck rows are released exactly once. */
let hasReleasedStuckRows = false;

/** Outcome of one row. */
const ROW_OUTCOME = {
  SYNCED: "synced",
  DUPLICATE: "duplicate",
  RETRY: "retry",
  FAILED: "failed",
  OFFLINE: "offline",
};

/**
 * Uploads a single claimed row and records the verdict.
 *
 * The row is already `syncing` when it arrives here, so every branch must leave
 * it in a terminal or retryable state — returning without writing would strand
 * it, which is the exact condition `releaseStuckSyncing` exists to clean up
 * after a crash and should never be reached by ordinary control flow.
 */
const syncRow = async (row) => {
  try {
    const outcome = await pushCheckin(row);

    if (outcome.result === PUSH_RESULT.INSERTED) {
      await markSynced({
        id: row.id,
        serverCheckinId: outcome.serverCheckinId,
        serverResponse: outcome.response,
      });
      console.log(`${LOG_PREFIX} Synced #${row.id}`, outcome.serverCheckinId);

      // The row is already committed as synced before this runs, and
      // `uploadQueuedPhoto` never throws — a missing attachment must not undo an
      // attendance record that the server has accepted.
      if (row.payload?.photoUri) {
        await uploadQueuedPhoto({
          photoUri: row.payload.photoUri,
          docname: outcome.serverCheckinId,
        });
      }

      return ROW_OUTCOME.SYNCED;
    }

    if (outcome.result === PUSH_RESULT.DUPLICATE) {
      await markSynced({
        id: row.id,
        serverCheckinId: outcome.serverCheckinId,
        serverResponse: outcome.response,
        duplicate: true,
        duplicateMessage: outcome.message,
      });
      console.log(
        `${LOG_PREFIX} Duplicate detected for #${row.id}; treating as synced`,
      );
      return ROW_OUTCOME.DUPLICATE;
    }

    // The server rejected it on its merits. Retrying replays the same rejection,
    // so this is terminal regardless of how many attempts remain.
    await markFailed({
      id: row.id,
      error: outcome.message,
      serverResponse: outcome.response,
    });
    console.log(`${LOG_PREFIX} Permanent failure on #${row.id}:`, outcome.message);
    return ROW_OUTCOME.FAILED;
  } catch (error) {
    const { kind, message, status } = classifyAttendanceError(error);

    // A duplicate can also arrive as a thrown 417 rather than a structured
    // per-record failure, depending on how the backend surfaces it.
    if (kind === FAILURE_KIND.DUPLICATE) {
      await markSynced({
        id: row.id,
        duplicate: true,
        duplicateMessage: message,
        serverResponse: error?.response?.data ?? null,
      });
      console.log(`${LOG_PREFIX} Duplicate (thrown) on #${row.id}`);
      return ROW_OUTCOME.DUPLICATE;
    }

    if (kind !== FAILURE_KIND.RETRYABLE) {
      await markFailed({
        id: row.id,
        error: message,
        serverResponse: error?.response?.data ?? null,
      });
      console.log(
        `${LOG_PREFIX} Terminal error on #${row.id} (${status ?? "no status"}):`,
        message,
      );
      return ROW_OUTCOME.FAILED;
    }

    if (row.retryCount >= MAX_RETRIES) {
      await markFailed({
        id: row.id,
        error: `Gave up after ${MAX_RETRIES} attempts: ${message}`,
      });
      console.log(`${LOG_PREFIX} Retry cap reached on #${row.id}`);
      return ROW_OUTCOME.FAILED;
    }

    const { retryCount, nextAttemptAt } = await markRetry({
      id: row.id,
      error: message,
    });
    console.log(
      `${LOG_PREFIX} Retry ${retryCount}/${MAX_RETRIES} for #${row.id} at`,
      new Date(nextAttemptAt).toISOString(),
    );

    // A transport failure means the network went away mid-drain. Nothing after
    // this row will fare better, so the caller stops rather than burning the
    // rest of the queue's retry budget on the same outage.
    return ROW_OUTCOME.OFFLINE;
  }
};

/**
 * Drains the queue once.
 *
 * Never throws and never runs twice at once: a second caller while a run is in
 * flight awaits the run already in progress and receives its summary, rather
 * than starting a drain of its own. That matters because the triggers overlap
 * heavily — launch, foreground and reconnect all fire within a second of each
 * other when a phone is picked up outside the office.
 *
 * @param {object} [options]
 * @param {string} [options.trigger] why the sync ran, for the log
 * @returns {Promise<{ran: boolean, synced: number, duplicates: number,
 *                     failed: number, remaining: number, reason?: string}>}
 */
export const syncPendingAttendance = async ({ trigger = "manual" } = {}) => {
  if (activeRun) return activeRun;

  activeRun = (async () => {
    const summary = {
      ran: false,
      synced: 0,
      duplicates: 0,
      failed: 0,
      remaining: 0,
      trigger,
    };

    try {
      // Rows left `syncing` by a killed process would otherwise never be
      // claimed again. Once per session is enough — within a session the
      // single-flight lock means nothing else can have stranded one.
      if (!hasReleasedStuckRows) {
        const released = await releaseStuckSyncing();
        hasReleasedStuckRows = true;
        if (released) {
          console.log(`${LOG_PREFIX} Released ${released} stuck row(s)`);
        }
      }

      if (!(await fetchIsOnline())) {
        summary.reason = "offline";
        return summary;
      }

      summary.ran = true;

      for (let processed = 0; processed < MAX_ROWS_PER_RUN; processed += 1) {
        const row = await claimNextPending();
        if (!row) break;

        const outcome = await syncRow(row);

        if (outcome === ROW_OUTCOME.SYNCED) summary.synced += 1;
        if (outcome === ROW_OUTCOME.DUPLICATE) summary.duplicates += 1;
        if (outcome === ROW_OUTCOME.FAILED) summary.failed += 1;

        if (outcome === ROW_OUTCOME.OFFLINE) {
          summary.reason = "connection-lost";
          break;
        }
      }

      // Housekeeping, not correctness — a failure here must not fail the run.
      try {
        await purgeSynced({ olderThanMs: SYNCED_RETENTION_MS });
      } catch (error) {
        console.log(`${LOG_PREFIX} Purge failed:`, error?.message);
      }

      const counts = await countByStatus();
      summary.remaining = counts.unsynced;

      if (summary.synced || summary.duplicates || summary.failed) {
        console.log(`${LOG_PREFIX} Run complete (${trigger})`, summary);
        notifyQueueChanged();
      }

      return summary;
    } catch (error) {
      console.log(`${LOG_PREFIX} Run aborted:`, error?.message);
      summary.reason = error?.message || "sync failed";
      return summary;
    } finally {
      activeRun = null;
    }
  })();

  return activeRun;
};

/** Whether a drain is in flight. Used by the UI's "Syncing" state. */
export const isSyncing = () => activeRun !== null;

/** Test seam. */
export const resetSyncService = () => {
  activeRun = null;
  hasReleasedStuckRows = false;
};

export default {
  SYNCED_RETENTION_MS,
  isSyncing,
  resetSyncService,
  syncPendingAttendance,
};

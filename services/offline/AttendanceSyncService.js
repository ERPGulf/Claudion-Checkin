// src/services/offline/AttendanceSyncService.js
import { PUSH_RESULT, pushCheckin } from "./AttendanceApi";
import { FAILURE_CLASS } from "./AttendanceDatabase";
import {
  MAX_RETRIES,
  claimNextPending,
  countByStatus,
  hasWorkDue,
  markBlocked,
  markRejected,
  markRetry,
  markSynced,
  peekNextRow,
  purgeSynced,
  releaseStuckSyncing,
  wakeBlocked,
  wakePending,
} from "./AttendanceQueueRepository";
import { notifyQueueChanged } from "./AttendanceQueueService";
import { classifyAttendanceError, FAILURE_KIND } from "./attendanceErrors";
import { uploadQueuedPhoto } from "./attendancePhotoUpload";
import {
  markOfflineSyncSupported,
  markOfflineSyncUnsupported,
} from "./offlineCapability";
import { fetchShouldAttemptRequest } from "./NetworkListener";

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

/** Lifecycle phases a listener is told about. */
export const SYNC_PHASE = {
  START: "start",
  FINISH: "finish",
};

const syncListeners = new Set();

/**
 * Registers a callback for the drain's lifecycle.
 *
 * `notifyQueueChanged` already reports that rows changed, but not that a run is
 * *in progress* — and "Syncing…" is a state the UI has to be able to enter and
 * leave, not infer. START fires only once real work is claimed, so a run that
 * finds nothing due stays invisible instead of flickering a spinner.
 *
 * @param {(event: {phase: string, summary?: object}) => void} listener
 * @returns {() => void} unsubscribe
 */
export const addSyncListener = (listener) => {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
};

const notifySync = (event) => {
  syncListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.log(`${LOG_PREFIX} Sync listener failed:`, error?.message);
    }
  });
};

/** Outcome of one row. */
const ROW_OUTCOME = {
  SYNCED: "synced",
  DUPLICATE: "duplicate",
  RETRY: "retry",
  BLOCKED: "blocked",
  REJECTED: "rejected",
  OFFLINE: "offline",
};

/** Outcomes that mean the rest of this run is pointless. */
const HALTS_RUN = new Set([ROW_OUTCOME.OFFLINE, ROW_OUTCOME.BLOCKED]);

/**
 * Uploads a single claimed row and records the verdict.
 *
 * The row is already `syncing` when it arrives here, so every branch must leave
 * it in a settled state — returning without writing would strand it, which is
 * the exact condition `releaseStuckSyncing` exists to clean up after a crash and
 * should never be reached by ordinary control flow.
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
      // Proof the endpoint is there and answering, which is what turns offline
      // attendance back on after a deploy — nobody has to tell the app.
      markOfflineSyncSupported();
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
      // A duplicate is still the endpoint answering.
      markOfflineSyncSupported();
      console.log(
        `${LOG_PREFIX} Duplicate detected for #${row.id}; treating as synced`,
      );
      return ROW_OUTCOME.DUPLICATE;
    }

    if (outcome.result === PUSH_RESULT.REJECTED) {
      const { cascaded } = await markRejected({
        id: row.id,
        failureClass: outcome.failureClass,
        error: outcome.message,
        serverResponse: outcome.response,
      });
      console.log(
        `${LOG_PREFIX} Rejected #${row.id} (${outcome.failureClass}):`,
        outcome.message,
        cascaded ? `— cascaded to ${cascaded} paired row(s)` : "",
      );
      return ROW_OUTCOME.REJECTED;
    }

    // Blocked: the server cannot take it *yet*. Kept, and retried on the slow
    // ladder until it can.
    if (outcome.failureClass === FAILURE_CLASS.ENDPOINT_MISSING) {
      markOfflineSyncUnsupported();
    }

    const { nextAttemptAt } = await markBlocked({
      id: row.id,
      failureClass: outcome.failureClass,
      error: outcome.message,
      serverResponse: outcome.response,
    });
    console.log(
      `${LOG_PREFIX} Blocked #${row.id} (${outcome.failureClass}); next attempt`,
      new Date(nextAttemptAt).toISOString(),
    );
    return ROW_OUTCOME.BLOCKED;
  } catch (error) {
    const { kind, failureClass, message, status } =
      classifyAttendanceError(error);

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

    if (kind === FAILURE_KIND.REJECTED) {
      const { cascaded } = await markRejected({
        id: row.id,
        failureClass,
        error: message,
        serverResponse: error?.response?.data ?? null,
      });
      console.log(
        `${LOG_PREFIX} Rejected #${row.id} (${status ?? "no status"}):`,
        message,
        cascaded ? `— cascaded to ${cascaded} paired row(s)` : "",
      );
      return ROW_OUTCOME.REJECTED;
    }

    if (kind === FAILURE_KIND.BLOCKED) {
      if (failureClass === FAILURE_CLASS.ENDPOINT_MISSING) {
        markOfflineSyncUnsupported();
      }

      await markBlocked({
        id: row.id,
        failureClass,
        error: message,
        serverResponse: error?.response?.data ?? null,
      });
      console.log(
        `${LOG_PREFIX} Blocked #${row.id} (${status ?? "no status"}):`,
        message,
      );
      return ROW_OUTCOME.BLOCKED;
    }

    // Transient from here. The cap exists so a row cannot spin on the fast
    // ladder forever — but it must not become terminal, so it is parked as
    // blocked and joins the slow schedule instead of being abandoned.
    if (row.retryCount >= MAX_RETRIES) {
      await markBlocked({
        id: row.id,
        failureClass: FAILURE_CLASS.UNKNOWN,
        error: `Still unreachable after ${MAX_RETRIES} attempts: ${message}`,
      });
      console.log(
        `${LOG_PREFIX} Retry cap on #${row.id}; moving to the slow schedule`,
      );
      return ROW_OUTCOME.BLOCKED;
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
 * One line per run, unconditionally — including the runs that do nothing.
 *
 * This used to be reported only when something happened, which meant the single
 * most important case logged nothing at all: a queue that is not moving. "Six
 * punches read Pending sync and the phone is plainly online" was unanswerable
 * from a device 4,000 miles away, because every candidate explanation — the
 * drain never ran, it ran and declined to attempt, it ran and claimed nothing,
 * it attempted and the row is mid-backoff — produced exactly the same silence.
 *
 * The head row is what separates them, so it is logged whatever its state. Raw
 * `error` text belongs here and only here: it is Frappe exception text, useful
 * to support and meaningless to the employee, so it stays out of the UI.
 */
const logRun = async (summary, employeeId) => {
  let head = null;

  try {
    head = await peekNextRow({ employeeId });
  } catch (error) {
    // Diagnostics must never be able to fail a drain.
    console.log(`${LOG_PREFIX} Head read failed:`, error?.message);
  }

  // An empty queue on a one-minute heartbeat has nothing to report and would
  // bury the lines that matter. The condition is "no unresolved row and nothing
  // happened" — NOT "nothing due", because a row waiting out its backoff is
  // exactly the case this log exists for.
  const changed =
    summary.synced ||
    summary.duplicates ||
    summary.blocked ||
    summary.rejected ||
    summary.woken ||
    summary.wokenPending;

  if (!head && !changed) return;

  console.log(`${LOG_PREFIX} Run (${summary.trigger})`, {
    ran: summary.ran,
    reason: summary.reason ?? null,
    scope: employeeId ?? "all",
    synced: summary.synced,
    duplicates: summary.duplicates,
    blocked: summary.blocked,
    rejected: summary.rejected,
    woken: summary.woken,
    wokenPending: summary.wokenPending,
    remaining: summary.remaining,
    head: head
      ? {
          id: head.id,
          action: head.action,
          punchedAt: head.timestamp,
          status: head.status,
          attempts: head.retryCount,
          failureClass: head.failureClass ?? null,
          nextAttemptAt: head.nextAttemptAt
            ? new Date(head.nextAttemptAt).toISOString()
            : "due",
          error: head.error ?? null,
        }
      : null,
  });
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
 * @param {boolean} [options.wakeAllBlocked] ignore the blocked backoff and
 *        re-attempt every blocked row — for launch, reconnect and token refresh
 * @param {boolean} [options.wakeAllPending] ignore the transient backoff too, so
 *        every pending row is due. Only for an explicit pull-to-refresh — the
 *        automatic triggers would reset the fast ladder on every app launch.
 *        Stranded rows (a due time beyond any real backoff) are repaired on
 *        every run regardless; see `wakePending`.
 * @param {string|null} [options.wakeFailureClass] wake only this class, so a
 *        token refresh retries auth-blocked rows without also re-attempting
 *        rows blocked on a missing endpoint
 * @param {string|null} [options.employeeId] only upload this employee's rows.
 *        Callers that know who is authenticated must pass it; leaving it null
 *        drains every row regardless of owner, which is only safe in tests.
 * @returns {Promise<{ran: boolean, synced: number, duplicates: number,
 *                     blocked: number, rejected: number, woken: number,
 *                     remaining: number, reason?: string}>}
 */
export const syncPendingAttendance = async ({
  trigger = "manual",
  wakeAllBlocked = false,
  wakeAllPending = false,
  wakeFailureClass = null,
  employeeId = null,
} = {}) => {
  if (activeRun) return activeRun;

  activeRun = (async () => {
    const summary = {
      ran: false,
      synced: 0,
      duplicates: 0,
      blocked: 0,
      rejected: 0,
      woken: 0,
      wokenPending: 0,
      remaining: 0,
      trigger,
    };

    let announcedStart = false;

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

      // Blocked rows rejoin the queue here. `wakeAllBlocked` ignores the backoff
      // for the events that genuinely change the odds — a launch (the server may
      // have been upgraded since), a reconnect, a token refresh — while the
      // scheduled tick respects the ladder. This is what makes recovery
      // automatic: nobody has to remember that a record is waiting.
      summary.woken = await wakeBlocked({
        force: wakeAllBlocked,
        failureClass: wakeFailureClass,
      });
      if (summary.woken) {
        console.log(
          `${LOG_PREFIX} Woke ${summary.woken} blocked row(s) for ${trigger}`,
        );
      }

      // Pending rows get the same treatment, for a reason the blocked ladder
      // does not have: the drain claims strictly in order, so a single pending
      // row that is not due holds back every later punch this employee has made.
      // By default this only repairs rows scheduled beyond any real backoff — a
      // clock that ran ahead — and an explicit pull makes every pending row due.
      summary.wokenPending = await wakePending({ force: wakeAllPending });
      if (summary.wokenPending) {
        console.log(
          `${LOG_PREFIX} Made ${summary.wokenPending} pending row(s) due for ${trigger}`,
        );
      }

      // `shouldAttemptRequest`, NOT `isOnline`. The drain has no user waiting
      // on it, so a wasted request costs nothing and a skipped one costs a
      // punch: on any network whose captive-portal probe fails, NetInfo reports
      // no internet for as long as the device stays on it, and gating the drain
      // on that verdict left rows in `pending` — "Pending sync", never
      // attempted, never escalated — while every request the app made worked.
      // Only a total absence of transport (aeroplane mode) stops a run now.
      // Nothing due: return before touching the radio. This is what makes a
      // one-minute heartbeat affordable — an idle tick is one indexed query,
      // no NetInfo call, no request, and (see logRun) no log line unless there
      // is actually a row sitting there.
      if (!(await hasWorkDue(Date.now(), { employeeId }))) {
        summary.reason = "nothing-due";
        await logRun(summary, employeeId);
        return summary;
      }

      if (!(await fetchShouldAttemptRequest())) {
        summary.reason = "offline";
        await logRun(summary, employeeId);
        return summary;
      }

      summary.ran = true;

      for (let processed = 0; processed < MAX_ROWS_PER_RUN; processed += 1) {
        // Scoped to the authenticated employee. Rows belonging to anyone else
        // are left untouched — see claimNextPending — because a queued punch is
        // uploaded under the current token, and filing one employee's
        // attendance against another is worse than it arriving late.
        const row = await claimNextPending(Date.now(), { employeeId });
        if (!row) break;

        // Announced on the first claimed row, not at the top of the run: a drain
        // that finds nothing due should not flash "Syncing…" at the user.
        if (processed === 0) {
          announcedStart = true;
          notifySync({ phase: SYNC_PHASE.START });
        }

        const outcome = await syncRow(row);

        if (outcome === ROW_OUTCOME.SYNCED) summary.synced += 1;
        if (outcome === ROW_OUTCOME.DUPLICATE) summary.duplicates += 1;
        if (outcome === ROW_OUTCOME.BLOCKED) summary.blocked += 1;
        if (outcome === ROW_OUTCOME.REJECTED) summary.rejected += 1;

        // Stop the run — and note that this also preserves FIFO. Everything
        // behind this row is older-first by construction, so halting leaves the
        // queue in order rather than skipping ahead to a later punch.
        //
        // OFFLINE: the network went away; nothing after it will fare better.
        // BLOCKED: the same server will refuse the next row identically, so
        // continuing would spend one pointless request per queued punch.
        if (HALTS_RUN.has(outcome)) {
          summary.reason =
            outcome === ROW_OUTCOME.OFFLINE ? "connection-lost" : "blocked";
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
      summary.remaining = counts.unresolvedCount;

      await logRun(summary, employeeId);

      if (
        summary.synced ||
        summary.duplicates ||
        summary.blocked ||
        summary.rejected ||
        summary.woken ||
        summary.wokenPending
      ) {
        notifyQueueChanged();
      }

      return summary;
    } catch (error) {
      console.log(`${LOG_PREFIX} Run aborted:`, error?.message);
      summary.reason = error?.message || "sync failed";
      return summary;
    } finally {
      activeRun = null;
      // Paired with START, and only when START was sent — a listener must never
      // be left holding a "syncing" state it was never told to leave.
      if (announcedStart) notifySync({ phase: SYNC_PHASE.FINISH, summary });
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
  syncListeners.clear();
};

export default {
  SYNCED_RETENTION_MS,
  SYNC_PHASE,
  addSyncListener,
  isSyncing,
  resetSyncService,
  syncPendingAttendance,
};

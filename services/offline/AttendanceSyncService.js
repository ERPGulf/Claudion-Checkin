// src/services/offline/AttendanceSyncService.js
import { PUSH_RESULT, pushCheckin } from "./AttendanceApi";
import { FAILURE_CLASS } from "./AttendanceDatabase";
import {
  MAX_RETRIES,
  claimNextPending,
  explainUnclaimable,
  beginAttendanceUpload,
  renewAttendanceClaim,
  QUEUE_CLAIM_CHANGED,
  countRecoveryByScope,
  findById,
  hasWorkDue,
  markBlocked,
  markRejected,
  markRetry,
  markSynced,
  markNeedsReview,
  peekNextRow,
  purgeSynced,
  releaseStuckSyncing,
  releaseClaim,
  listUncertainUploadClaims,
  recordServerVerification,
  recordVerificationIssue,
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
import { ATTENDANCE_SCOPE_CHANGED, assertAttendanceQueueScope, captureAttendanceQueueScope } from "./attendanceQueueProvenance";
import { verifyQueuedAttendance } from "./AttendanceVerification";
import { isoTime, logAttendanceDiagnostic } from "./attendanceDiagnostics";

/**
 * Draining the queue.
 *
 * One row at a time, oldest first, until there is nothing due or the network
 * gives out. FIFO is not cosmetic here: a check-out uploaded before its
 * check-in produces a session the backend cannot reconcile, so order is part of
 * correctness rather than tidiness.
 *
 * Three safeguards protect submission without assuming backend exactly-once:
 *  1. the single-flight promise below, which stops two drains in this JS context,
 *  2. the atomic owned claim and lease, which retain live work across runtimes,
 *  3. durable dispatch evidence, which requires positive history verification
 *     before a request with an uncertain previous outcome can be sent again.
 *
 * Duplicate responses are also verified before they become confirmed success.
 */

const LOG_PREFIX = "[AttendanceSyncService]";

/** Stops one bad row from spinning the drain forever within a single pass. */
const MAX_ROWS_PER_RUN = 50;

/** Legacy retention value; purgeSynced is suspended to preserve recovery evidence. */
export const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The in-flight run, or null. Concurrency control — see (1) above. */
let activeRun = null;
let activeScope = null;
let runGeneration = 0;
export const cancelActiveSync = () => { runGeneration += 1; };

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
  SCOPE_CHANGED: "scope-changed",
  NEEDS_REVIEW: "needs_review",
  CLAIM_CHANGED: "claim-changed",
};

/** Outcomes that mean the rest of this run is pointless. */
const HALTS_RUN = new Set([ROW_OUTCOME.OFFLINE, ROW_OUTCOME.BLOCKED, ROW_OUTCOME.SCOPE_CHANGED, ROW_OUTCOME.NEEDS_REVIEW, ROW_OUTCOME.CLAIM_CHANGED]);

// Development diagnostics only: what each settled state means for the queue.
const QUEUE_LOG = "[AttendanceQueue]";
const HOLDS_LATER_ROWS = (row) => ["pending", "syncing", "needs_review"].includes(row?.status) ||
  (row?.status === "synced" && row.acceptanceConfirmed !== 1) ||
  (row?.status === "blocked" && row.failureClass !== FAILURE_CLASS.ENDPOINT_MISSING);
const retryEligibility = (row) => {
  const due = isoTime(row?.nextAttemptAt) ?? "now";
  if (row?.status === "pending") return row.uploadAttemptAt
    ? `Due ${due}. A request was already dispatched, so the next claim verifies server history and never re-sends.`
    : `Due ${due}; will be uploaded.`;
  if (row?.status === "blocked") return `Blocked ladder, next ${due}; woken early on launch, reconnect or token refresh.`;
  if (row?.status === "needs_review") return ["upload-outcome-unverified", "server-unavailable"].includes(row.verificationIssue)
    ? "Never re-sent; server history is re-checked automatically on later runs."
    : `Never re-sent and not re-checked automatically (verificationIssue=${row.verificationIssue ?? "null"}); only Check server record re-checks it.`;
  return "Final; no further attempts.";
};
const HALT_WHY = {
  [ROW_OUTCOME.OFFLINE]: "Transport or server failure; later rows would fail the same way.",
  [ROW_OUTCOME.BLOCKED]: "The server refused in a way later rows would repeat.",
  [ROW_OUTCOME.NEEDS_REVIEW]: "Every later row for this employee is held behind a needs_review row and is not attempted.",
  [ROW_OUTCOME.SCOPE_CHANGED]: "The account or tenant changed.",
  [ROW_OUTCOME.CLAIM_CHANGED]: "Another runtime took the claim.",
};

const attachConfirmedPhoto = async (row, serverCheckinId, syncScope, report = {}) => {
  if (!row.payload?.photoUri) return;
  const photo = await uploadQueuedPhoto({ photoUri: row.payload.photoUri, docname: serverCheckinId, syncScope });
  report.photoStatus = photo?.uploaded ? "uploaded" : "not-uploaded";
};

const settleDuplicate = async (row, syncScope, message, response, report) => {
  try {
    const verification = await verifyQueuedAttendance(row, { syncScope });
    await renewAttendanceClaim({ id: row.id, claimOwner: row.claimOwner });
    await assertAttendanceQueueScope(syncScope);
    if (verification.verified) {
      await markSynced({ id: row.id, claimOwner: row.claimOwner, serverCheckinId: verification.evidence.name,
        serverResponse: response, duplicate: true, duplicateMessage: message,
        acceptanceConfirmed: true, verificationEvidence: verification.evidence });
      await attachConfirmedPhoto(row, verification.evidence.name, syncScope, report);
      return ROW_OUTCOME.DUPLICATE;
    }
    await markNeedsReview({ id: row.id, claimOwner: row.claimOwner, error: message, serverResponse: response, duplicate: true });
    return ROW_OUTCOME.NEEDS_REVIEW;
  } catch (error) {
    if (error?.code === QUEUE_CLAIM_CHANGED) return ROW_OUTCOME.CLAIM_CHANGED;
    if (error?.code === ATTENDANCE_SCOPE_CHANGED) {
      await markNeedsReview({ id: row.id, claimOwner: row.claimOwner,
        error: "The account changed while duplicate verification was pending." });
      return ROW_OUTCOME.SCOPE_CHANGED;
    }
    await markNeedsReview({ id: row.id, claimOwner: row.claimOwner, error: message, serverResponse: response, duplicate: true });
    return ROW_OUTCOME.NEEDS_REVIEW;
  }
};

/**
 * Uploads a single claimed row and records the verdict.
 *
 * The row is already `syncing` when it arrives here, so every branch must leave
 * it in a settled state — returning without writing would strand it, which is
 * the exact condition `releaseStuckSyncing` exists to clean up after a crash and
 * should never be reached by ordinary control flow.
 */
const syncRow = async (row, syncScope, report) => {
  let dispatched = !!row.uploadAttemptAt;
  const heartbeat = setInterval(() => {
    renewAttendanceClaim({ id: row.id, claimOwner: row.claimOwner }).catch(() => {});
  }, 30000);
  try {
    await assertAttendanceQueueScope(syncScope);
    if (row.uploadAttemptAt) {
      logAttendanceDiagnostic(QUEUE_LOG, `#${row.id} syncing → verification`, {
        reason: `A request was dispatched at ${isoTime(row.uploadAttemptAt)} without a confirmed outcome; only an exact server-history match may settle it, and it is never re-sent.`,
        attemptCount: row.attemptCount, retryCount: row.retryCount, lastError: row.error ?? null,
      });
      const verification = await verifyQueuedAttendance(row, { syncScope });
      await assertAttendanceQueueScope(syncScope);
      await renewAttendanceClaim({ id: row.id, claimOwner: row.claimOwner });
      if (verification.verified) {
        await markSynced({ id: row.id, claimOwner: row.claimOwner,
          serverCheckinId: verification.evidence.name, acceptanceConfirmed: true,
          verificationEvidence: verification.evidence });
        await attachConfirmedPhoto(row, verification.evidence.name, syncScope, report);
        return ROW_OUTCOME.SYNCED;
      }
      if (verification.reason === "server-unavailable") {
        if (row.retryCount >= MAX_RETRIES) {
          await markBlocked({ id: row.id, claimOwner: row.claimOwner, failureClass: FAILURE_CLASS.UNKNOWN,
            error: "Previous attendance upload is awaiting server verification." });
          return ROW_OUTCOME.BLOCKED;
        }
        await markRetry({ id: row.id, claimOwner: row.claimOwner, error: "Server verification is temporarily unavailable." });
        return ROW_OUTCOME.OFFLINE;
      }
      await markNeedsReview({ id: row.id, claimOwner: row.claimOwner,
        error: "Previous attendance upload could not be confirmed by exact server history." });
      return ROW_OUTCOME.NEEDS_REVIEW;
    }
    await beginAttendanceUpload({ id: row.id, claimOwner: row.claimOwner });
    logAttendanceDiagnostic(QUEUE_LOG, `#${row.id} syncing → uploading`, {
      reason: "uploadAttemptAt recorded before the POST. From here a failure without proof of the outcome is settled only by server history.",
      attemptCount: row.attemptCount, retryCount: row.retryCount,
    });
    dispatched = true;
    const outcome = await pushCheckin(row, { syncScope });
    await renewAttendanceClaim({ id: row.id, claimOwner: row.claimOwner });

    if (outcome.result === PUSH_RESULT.INSERTED) {
      if (typeof outcome.serverCheckinId !== "string" || !outcome.serverCheckinId.trim()) {
        await markNeedsReview({ id: row.id, claimOwner: row.claimOwner, error: "The server did not return an attendance reference.", serverResponse: outcome.response });
        return ROW_OUTCOME.NEEDS_REVIEW;
      }
      await markSynced({
        id: row.id, claimOwner: row.claimOwner,
        serverCheckinId: outcome.serverCheckinId,
        serverResponse: outcome.response,
        acceptanceConfirmed: true,
      });
      // Proof the endpoint is there and answering, which is what turns offline
      // attendance back on after a deploy — nobody has to tell the app.
      if (await assertAttendanceQueueScope(syncScope).then(() => true, () => false)) markOfflineSyncSupported();
      console.log(`${LOG_PREFIX} Synced #${row.id}`, outcome.serverCheckinId);

      // The row is already committed as synced before this runs, and
      // `uploadQueuedPhoto` never throws — a missing attachment must not undo an
      // attendance record that the server has accepted.
      await attachConfirmedPhoto(row, outcome.serverCheckinId, syncScope, report);

      return ROW_OUTCOME.SYNCED;
    }

    if (outcome.result === PUSH_RESULT.DUPLICATE) {
      return await settleDuplicate(row, syncScope, outcome.message, outcome.response, report);
    }

    if (outcome.result === "needs_review") {
      await markNeedsReview({ id: row.id, claimOwner: row.claimOwner, error: outcome.message, serverResponse: outcome.response });
      return ROW_OUTCOME.NEEDS_REVIEW;
    }

    if (outcome.result === PUSH_RESULT.REJECTED) {
      const { cascaded } = await markRejected({
        id: row.id, claimOwner: row.claimOwner,
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
    await assertAttendanceQueueScope(syncScope);
    if (outcome.failureClass === FAILURE_CLASS.ENDPOINT_MISSING) {
      markOfflineSyncUnsupported();
    }

    const { nextAttemptAt } = await markBlocked({
      id: row.id, claimOwner: row.claimOwner,
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
    if (error?.code === QUEUE_CLAIM_CHANGED) return ROW_OUTCOME.CLAIM_CHANGED;
    const scopeValid = await assertAttendanceQueueScope(syncScope).then(() => true, () => false);
    if (error?.code === ATTENDANCE_SCOPE_CHANGED || !scopeValid) {
      if (dispatched) {
        await markNeedsReview({ id: row.id, claimOwner: row.claimOwner,
          error: "The account changed while the upload outcome was unknown." });
      } else await releaseClaim({ id: row.id, claimOwner: row.claimOwner });
      return ROW_OUTCOME.SCOPE_CHANGED;
    }
    const { kind, failureClass, message, status } =
      classifyAttendanceError(error);

    // A duplicate can also arrive as a thrown 417 rather than a structured
    // per-record failure, depending on how the backend surfaces it.
    if (kind === FAILURE_KIND.DUPLICATE) {
      return await settleDuplicate(row, syncScope, message, error?.response?.data ?? null, report);
    }

    if (kind === FAILURE_KIND.REJECTED) {
      const { cascaded } = await markRejected({
        id: row.id, claimOwner: row.claimOwner,
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
        id: row.id, claimOwner: row.claimOwner,
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
        id: row.id, claimOwner: row.claimOwner,
        failureClass: FAILURE_CLASS.UNKNOWN,
        error: `Still unreachable after ${MAX_RETRIES} attempts: ${message}`,
      });
      console.log(
        `${LOG_PREFIX} Retry cap on #${row.id}; moving to the slow schedule`,
      );
      return ROW_OUTCOME.BLOCKED;
    }

    const { retryCount, nextAttemptAt } = await markRetry({
      id: row.id, claimOwner: row.claimOwner,
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
  } finally {
    clearInterval(heartbeat);
  }
};

const verifyInterruptedUploads = async (scope, syncScope, summary) => {
  const rows = await listUncertainUploadClaims(scope);
  if (!rows.length || !await fetchShouldAttemptRequest()) return;
  for (const row of rows) {
    await assertAttendanceQueueScope(syncScope);
    const verification = await verifyQueuedAttendance(row, { syncScope });
    await assertAttendanceQueueScope(syncScope);
    if (verification.verified) {
      const changed = await recordServerVerification({ row, evidence: verification.evidence });
      if (changed) {
        notifyQueueChanged();
        summary.synced += 1;
        summary.records.push({ id: row.id, action: row.action, timestamp: row.timestamp,
          status: "synced", outcome: "verified-interrupted-upload" });
        await attachConfirmedPhoto(row, verification.evidence.name, syncScope, summary.records[summary.records.length - 1]);
      }
    } else {
      await recordVerificationIssue({ row, reason: verification.reason || "upload-outcome-unverified" });
    }
    logAttendanceDiagnostic(QUEUE_LOG, `#${row.id} needs_review → ${verification.verified ? "synced" : "needs_review"} (automatic re-check)`, {
      reason: verification.verified ? `Verified as ${verification.evidence.name}` : verification.reason,
    });
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
    summary.needsReview ||
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
    needsReview: summary.needsReview,
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
  syncScope = null,
} = {}) => {
  const requestedGeneration = runGeneration;
  if (!employeeId) return { ran: false, reason: "no-employee", records: [] };
  try {
    syncScope = syncScope ?? await captureAttendanceQueueScope(employeeId);
    await assertAttendanceQueueScope(syncScope);
    if (requestedGeneration !== runGeneration) return { ran: false, reason: "scope-changed", records: [] };
    if (syncScope.employeeId !== employeeId) return { ran: false, reason: "scope-changed", records: [] };
  } catch {
    return { ran: false, reason: "scope-changed", records: [] };
  }
  if (activeRun) {
    const sameScope = activeScope?.employeeId === employeeId &&
      activeScope?.tenantKey === syncScope.tenantKey &&
      activeScope?.generation === syncScope.generation &&
      activeScope?.accountId === syncScope.accountId && !activeScope?.isCancelled?.();
    return sameScope ? activeRun : { ran: false, reason: "another-session-syncing", records: [] };
  }
  const generation = runGeneration;
  const callerCancelled = syncScope.isCancelled;
  syncScope = { ...syncScope, isCancelled: () => generation !== runGeneration || !!callerCancelled?.() };
  activeScope = syncScope;
  const scope = { employeeId, tenantKey: syncScope.tenantKey };

  activeRun = (async () => {
    const summary = {
      ran: false,
      synced: 0,
      duplicates: 0,
      blocked: 0,
      rejected: 0,
      needsReview: 0,
      woken: 0,
      wokenPending: 0,
      remaining: 0,
      trigger,
      records: [],
    };

    let announcedStart = false;

    try {
      // Live claims remain owned across runtimes. Interrupted uploads require
      // positive history evidence instead of resetting a possibly sent request.
      await assertAttendanceQueueScope(syncScope);
      await releaseStuckSyncing(Date.now(), scope);
      await verifyInterruptedUploads(scope, syncScope, summary);

      // Blocked rows rejoin the queue here. `wakeAllBlocked` ignores the backoff
      // for the events that genuinely change the odds — a launch (the server may
      // have been upgraded since), a reconnect, a token refresh — while the
      // scheduled tick respects the ladder. This is what makes recovery
      // automatic: nobody has to remember that a record is waiting.
      await assertAttendanceQueueScope(syncScope);
      summary.woken = await wakeBlocked({
        ...scope,
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
      await assertAttendanceQueueScope(syncScope);
      summary.wokenPending = await wakePending({ ...scope, force: wakeAllPending });
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
      if (!(await hasWorkDue(Date.now(), scope))) {
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
        await assertAttendanceQueueScope(syncScope);
        const row = await claimNextPending(Date.now(), scope);
        if (!row) break;

        // Announced on the first claimed row, not at the top of the run: a drain
        // that finds nothing due should not flash "Syncing…" at the user.
        if (processed === 0) {
          announcedStart = true;
          notifySync({ phase: SYNC_PHASE.START });
        }

        logAttendanceDiagnostic(QUEUE_LOG, `#${row.id} pending → syncing`, {
          action: row.action, timestamp: row.timestamp, reason: `claimed (${trigger}); no older unresolved row holds it`,
          attemptCount: row.attemptCount, retryCount: row.retryCount, lastError: row.error ?? null,
          uploadDispatchedAt: isoTime(row.uploadAttemptAt),
        });
        const report = { id: row.id, action: row.action, timestamp: row.timestamp };
        const outcome = await syncRow(row, syncScope, report);
        const saved = await findById(row.id);
        logAttendanceDiagnostic(QUEUE_LOG, `#${row.id} syncing → ${saved?.status}`, {
          action: row.action, timestamp: row.timestamp, outcome, reason: saved?.error ?? outcome,
          attemptCount: saved?.attemptCount, retryCount: saved?.retryCount, failureClass: saved?.failureClass ?? null,
          verificationIssue: saved?.verificationIssue ?? null, uploadDispatchedAt: isoTime(saved?.uploadAttemptAt),
          retryEligibility: retryEligibility(saved), holdsLaterRows: HOLDS_LATER_ROWS(saved),
        });
        summary.records.push({
          ...report,
          status: saved?.status,
          duplicate: saved?.duplicate ?? false,
          failureClass: saved?.failureClass,
          outcome,
        });

        if (outcome === ROW_OUTCOME.SYNCED) summary.synced += 1;
        if (outcome === ROW_OUTCOME.DUPLICATE) summary.duplicates += 1;
        if (outcome === ROW_OUTCOME.BLOCKED) summary.blocked += 1;
        if (outcome === ROW_OUTCOME.REJECTED) summary.rejected += 1;
        if (outcome === ROW_OUTCOME.NEEDS_REVIEW) summary.needsReview += 1;

        // Stop the run — and note that this also preserves FIFO. Everything
        // behind this row is older-first by construction, so halting leaves the
        // queue in order rather than skipping ahead to a later punch.
        //
        // OFFLINE: the network went away; nothing after it will fare better.
        // BLOCKED: the same server will refuse the next row identically, so
        // continuing would spend one pointless request per queued punch.
        if (HALTS_RUN.has(outcome)) {
          summary.reason =
            outcome === ROW_OUTCOME.CLAIM_CHANGED ? "claim-changed" :
              outcome === ROW_OUTCOME.SCOPE_CHANGED ? "scope-changed" :
              outcome === ROW_OUTCOME.OFFLINE ? "connection-lost" :
                outcome === ROW_OUTCOME.NEEDS_REVIEW ? "needs-review" : "blocked";
          logAttendanceDiagnostic(LOG_PREFIX, `run stopped at #${row.id}: ${summary.reason}`, { why: HALT_WHY[outcome] });
          break;
        }
      }

      if (__DEV__) {
        try {
          const held = await explainUnclaimable(scope);
          if (held.length) logAttendanceDiagnostic(QUEUE_LOG, `${held.length} due row(s) not claimed`, held);
        } catch (error) {
          console.log(`${QUEUE_LOG} Unclaimed-row diagnostics failed:`, error?.message);
        }
      }

      // Housekeeping, not correctness — a failure here must not fail the run.
      try {
        await purgeSynced({ olderThanMs: SYNCED_RETENTION_MS });
      } catch (error) {
        console.log(`${LOG_PREFIX} Purge failed:`, error?.message);
      }

      const counts = await countRecoveryByScope(scope);
      summary.remaining = counts.recoverableCount + counts.syncingCount + counts.rejectedCount + counts.reviewCount;

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
      summary.reason = error?.code === ATTENDANCE_SCOPE_CHANGED ? "scope-changed" : "sync-error";
      return summary;
    } finally {
      activeRun = null;
      activeScope = null;
      notifyQueueChanged();
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
  activeScope = null;
  runGeneration += 1;
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

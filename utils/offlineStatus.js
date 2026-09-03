import { format } from "date-fns";

/**
 * What the attendance status banner says, and whether it says anything at all.
 *
 * Pure: given connectivity, the queue's counts and whether a drain is running,
 * it returns one phase and the exact words for it. Kept out of the component so
 * the copy can be unit-tested and changed in one place — and because the wording
 * here does real work. These messages are read by someone who has just
 * discovered their attendance did not go through, and the difference between
 * "failed" and "safely saved, still trying" is the difference between a support
 * ticket and none.
 */

export const OFFLINE_PHASE = {
  /** Nothing to say. */
  HIDDEN: "hidden",
  /** No connection. Transient, self-resolving. */
  OFFLINE: "offline",
  /** Back online and the drain is working through the queue. */
  SYNCING: "syncing",
  /** The drain just finished with something to show for it. */
  SYNCED: "synced",
  /** Blocked rows — the server cannot accept them yet. Nobody here can fix it. */
  NEEDS_ADMIN: "needs-admin",
  /** Rejected rows — only an attendance correction resolves these. */
  NEEDS_CORRECTION: "needs-correction",
  /**
   * Pending rows that have stopped looking like ordinary queueing.
   *
   * The state that had no banner at all. A punch queued a minute ago needs no
   * announcement — it will be gone before anyone reads it — but the same punch
   * still pending the next morning is the one thing the employee genuinely
   * needs to know, and until now the app was silent about it: `pending` outlives
   * the offline banner (the phone is back on wifi) and never reaches the
   * administrator banner (nothing is blocked). Six records sat unmentioned on a
   * production device while the only screen that showed them offered no way to
   * ask why.
   */
  WAITING: "waiting",
};

/** How long the success state lingers before the banner retires itself. */
export const SYNCED_VISIBLE_MS = 2000;

/**
 * How long a punch may sit pending before the banner mentions it.
 *
 * An hour, which is the transient retry ladder's own last step: past that point
 * the queue has had every fast attempt it is going to get, so a row still
 * waiting is no longer mid-schedule — it is a row nothing has been able to
 * deliver. Shorter would announce every lift ride and every basement.
 */
export const STALE_PENDING_MS = 60 * 60 * 1000;

/**
 * Precedence, most important first.
 *
 * The two persistent states outrank being offline, which looks backwards until
 * you consider how each one ends. Offline resolves itself, is already visible in
 * the OS status bar, and will come back the moment it matters. A rejected or
 * blocked record resolves only when somebody does something, and it can sit
 * there for days — so it gets the one banner slot. Correction outranks
 * administrator because it is the one the employee can actually act on.
 */
const PHASE_PRECEDENCE = [
  OFFLINE_PHASE.NEEDS_CORRECTION,
  OFFLINE_PHASE.NEEDS_ADMIN,
  OFFLINE_PHASE.OFFLINE,
  OFFLINE_PHASE.SYNCING,
  OFFLINE_PHASE.SYNCED,
  // Last. Every phase above it is a better explanation of the same records:
  // offline says why they are waiting, syncing says they are moving right now,
  // and the two persistent states name a specific cause. This one is what is
  // left when a record is waiting and nothing else can account for it.
  OFFLINE_PHASE.WAITING,
];

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const records = (count) => plural(count, "attendance record");

/**
 * Resolves the banner's phase from everything that is simultaneously true.
 *
 * @param {object} state
 * @param {boolean} state.online
 * @param {boolean} [state.syncing] a drain is in flight
 * @param {number} [state.blocked] rows waiting on the server/administrator
 * @param {number} [state.rejected] rows needing a correction
 * @param {number} [state.pending] rows still queued for an ordinary attempt
 * @param {number|null} [state.oldestPendingAt] when the oldest of those was
 *        queued, which is what separates ordinary queueing from a queue that
 *        has stopped moving. Pass null to keep the waiting phase silent.
 * @param {number|null} [state.justSyncedAt] when a drain last landed something
 */
export const resolveOfflinePhase = ({
  online,
  syncing = false,
  blocked = 0,
  rejected = 0,
  pending = 0,
  oldestPendingAt = null,
  justSyncedAt = null,
  now = Date.now(),
}) => {
  const active = new Set();

  if (rejected > 0) active.add(OFFLINE_PHASE.NEEDS_CORRECTION);
  if (blocked > 0) active.add(OFFLINE_PHASE.NEEDS_ADMIN);
  if (!online) active.add(OFFLINE_PHASE.OFFLINE);
  if (online && syncing) active.add(OFFLINE_PHASE.SYNCING);
  if (
    online &&
    !syncing &&
    Number.isFinite(justSyncedAt) &&
    now - justSyncedAt < SYNCED_VISIBLE_MS
  ) {
    active.add(OFFLINE_PHASE.SYNCED);
  }
  if (
    online &&
    pending > 0 &&
    Number.isFinite(oldestPendingAt) &&
    now - oldestPendingAt >= STALE_PENDING_MS
  ) {
    active.add(OFFLINE_PHASE.WAITING);
  }

  return (
    PHASE_PRECEDENCE.find((phase) => active.has(phase)) ?? OFFLINE_PHASE.HIDDEN
  );
};

/**
 * Phase + counts → everything the component renders.
 *
 * `tone` indexes the palette's status triads (`warningSurface` /
 * `warningBorder` / `warningText`), so the banner can never end up with a
 * success background and a warning glyph, and dark mode comes for free.
 *
 * `motion` names the trailing icon's behaviour rather than describing it, and
 * `actionable` tells the banner whether tapping it should open the detail sheet
 * — only the two states with something to explain are.
 */
export const describeOfflineStatus = (
  phase,
  { pending = 0, blocked = 0, rejected = 0, awaitingServer = 0 } = {},
) => {
  switch (phase) {
    case OFFLINE_PHASE.OFFLINE:
      return {
        tone: "warning",
        icon: "cloud-offline-outline",
        // Amber, not red: being offline is a condition to be aware of, not a
        // failure. Nothing has gone wrong and nothing is lost.
        title: "You're offline",
        subtitle: pending
          ? `${records(pending)} waiting to sync`
          : "Attendance will sync automatically when you're back online.",
        trailingIcon: "cloud-upload-outline",
        motion: "pulse",
        actionable: false,
      };

    case OFFLINE_PHASE.SYNCING:
      return {
        tone: "info",
        icon: "cloud-upload-outline",
        title: "Syncing attendance…",
        subtitle: pending ? `${plural(pending, "record")} remaining` : null,
        trailingIcon: "sync-outline",
        motion: "spin",
        actionable: false,
      };

    case OFFLINE_PHASE.SYNCED:
      return {
        tone: "success",
        icon: "checkmark-circle",
        title: "All attendance synced",
        subtitle: null,
        trailingIcon: null,
        motion: "none",
        actionable: false,
      };

    case OFFLINE_PHASE.WAITING:
      return {
        tone: "warning",
        icon: "cloud-upload-outline",
        // No blame and no alarm: the records are safe, and the employee has not
        // done anything wrong. What this state adds over silence is simply that
        // the app knows they are still here — and a way in to the detail, which
        // is where the diagnostics that make a support report possible live.
        title: "Attendance still waiting to sync",
        subtitle: `${records(pending)} saved on your device. Tap for details.`,
        trailingIcon: "chevron-forward",
        motion: "none",
        actionable: true,
      };

    case OFFLINE_PHASE.NEEDS_ADMIN:
      return {
        tone: "warning",
        icon: "shield-outline",
        // The whole point of this state. The employee did nothing wrong, has
        // lost nothing, and can do nothing — so the message leads with the
        // reassurance and never uses the word "failed".
        //
        // The count moved to the subtitle after seeing it on a device: with it
        // in the title the line truncated mid-word at "administrat…", which
        // reads like a broken string rather than a status.
        title: "Waiting for your administrator",
        // Counts everything the server has not taken, not just the row that
        // happened to be claimed when the drain halted. A blocked row stops the
        // run, so every punch behind it is waiting on the same fix — reporting
        // "1" while six sit in the sheet is the kind of small lie that costs
        // trust in the whole indicator.
        subtitle: `${records(Math.max(awaitingServer, blocked))} saved on your device — we'll keep trying automatically.`,
        trailingIcon: "chevron-forward",
        motion: "none",
        actionable: true,
      };

    case OFFLINE_PHASE.NEEDS_CORRECTION:
      return {
        tone: "error",
        icon: "alert-circle",
        title: `${records(rejected)} ${rejected === 1 ? "needs" : "need"} correction`,
        subtitle: "Tap to review and submit an attendance request.",
        trailingIcon: "chevron-forward",
        motion: "none",
        actionable: true,
      };

    default:
      return null;
  }
};

/**
 * Per-row copy for the sync sheet: what happened, and — the question the row
 * actually raises — whether anyone needs to do anything about it.
 */
export const describeQueueRow = (row) => {
  const failureClass = row?.failureClass;

  // A row that has been blocked before is still waiting on the same person,
  // even in the moment it sits back in `pending` between attempts. Reporting it
  // as an ordinary pending row for those windows would flicker the explanation
  // and, worse, imply the delay is normal queueing rather than a server problem.
  const status =
    row?.status === "pending" && row?.blockedSince ? "blocked" : row?.status;

  if (status === "rejected") {
    const dependent = failureClass === "dependent";

    return {
      tone: "error",
      label: "Needs correction",
      // A cascade is not a rejection of this punch — it is collateral from the
      // other half of the session, and saying so stops it reading as two
      // separate problems.
      reason: dependent
        ? "Its check-in was rejected, so this check-out was held back to keep the session consistent."
        : "Your organization's system couldn't accept this attendance record.",
      willRetry: false,
      needsAdmin: false,
      needsEmployee: true,
      canCorrect: true,
    };
  }

  if (status === "blocked") {
    return {
      tone: "warning",
      label: "Waiting for administrator",
      reason:
        failureClass === "endpoint-missing"
          ? "Your organization's server isn't set up to accept offline attendance yet."
          : failureClass === "auth"
            ? "Your session needs to be re-established before this can be sent."
            : failureClass === "configuration"
              ? "Something is missing in your organization's server configuration."
              : "Your organization's server can't accept this attendance right now.",
      willRetry: true,
      needsAdmin: failureClass !== "auth",
      needsEmployee: false,
      canCorrect: false,
    };
  }

  if (status === "syncing") {
    return {
      tone: "info",
      label: "Syncing",
      reason: "Being sent to the server now.",
      willRetry: true,
      needsAdmin: false,
      needsEmployee: false,
      canCorrect: false,
    };
  }

  if (status === "resolved") {
    return {
      tone: "neutral",
      label: "Correction submitted",
      reason: row?.resolutionDocname
        ? `Covered by attendance request ${row.resolutionDocname}.`
        : "Covered by an attendance request.",
      willRetry: false,
      needsAdmin: false,
      needsEmployee: false,
      canCorrect: false,
    };
  }

  return {
    tone: "warning",
    label: "Pending sync",
    // No `row.error` here, on purpose. It holds whatever the server or the
    // network last said — Frappe returns multi-line Python exception text — and
    // showing that to an employee is noise they cannot act on. It stays on the
    // row for logs and support.
    reason: "Saved on your device, waiting to be sent.",
    willRetry: true,
    needsAdmin: false,
    needsEmployee: false,
    canCorrect: false,
  };
};

/**
 * The support line: what state this row is in, how often it has been tried, and
 * when it will be tried next.
 *
 * Deliberately terse and deliberately not prose. `describeQueueRow` above is
 * the employee's explanation and stays free of jargon; this is the line someone
 * screenshots and sends when the explanation is not enough — which is the
 * situation this whole addition comes from. Six punches read "Pending sync" on a
 * phone 4,000 miles away and there was no way to tell whether they had been
 * attempted forty times or never once, because nothing the employee could see
 * distinguished those two.
 *
 * Still no `row.error`. The state, the attempt count and the due time are facts
 * about the queue; the error is Frappe exception text, and it stays in the log.
 *
 * @returns {string|null} null when there is nothing worth showing
 */
export const describeQueueDiagnostics = (row, { now = Date.now() } = {}) => {
  if (!row?.id) return null;

  const parts = [`#${row.id}`];

  const state = [row.status, row.failureClass].filter(Boolean).join("/");
  if (state) parts.push(state);

  const attempts = Number(row.retryCount) || 0;
  parts.push(attempts === 0 ? "no attempts yet" : plural(attempts, "attempt"));

  // Only where a next attempt is a real thing. A rejected row is never retried
  // and a resolved one is history, so a due time there would be a lie.
  if (row.status === "pending" || row.status === "blocked") {
    const nextAttemptAt = Number(row.nextAttemptAt) || 0;
    parts.push(
      nextAttemptAt > now
        ? `next ${format(new Date(nextAttemptAt), "HH:mm")}`
        : "due now",
    );
  }

  return parts.join(" · ");
};

/** One string for screen readers, since the row is two visual lines. */
export const describeOfflineStatusForA11y = (content) =>
  [content?.title, content?.subtitle].filter(Boolean).join(". ");

export default {
  OFFLINE_PHASE,
  STALE_PENDING_MS,
  SYNCED_VISIBLE_MS,
  describeOfflineStatus,
  describeOfflineStatusForA11y,
  describeQueueDiagnostics,
  describeQueueRow,
  resolveOfflinePhase,
};

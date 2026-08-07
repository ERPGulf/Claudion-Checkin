/**
 * What the connectivity banner says, and whether it says anything at all.
 *
 * Pure: given connectivity, the queue depth and whether a drain is running, it
 * returns one phase and the exact words for it. Kept out of the component so the
 * copy can be unit-tested and changed in one place — a status line that says
 * "3 attendance records" when there is one is the kind of thing nobody notices
 * until a user screenshots it.
 */

export const OFFLINE_PHASE = {
  /** Nothing to say — online, idle, nothing queued. */
  HIDDEN: "hidden",
  /** No connection. */
  OFFLINE: "offline",
  /** Back online and the drain is working through the queue. */
  SYNCING: "syncing",
  /** The drain just finished with something to show for it. */
  SYNCED: "synced",
};

/** How long the success state lingers before the banner retires itself. */
export const SYNCED_VISIBLE_MS = 2000;

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Resolves the banner's phase.
 *
 * Offline outranks everything, including an in-flight sync: if the connection
 * drops mid-drain, "You're offline" is the more useful and more honest of the
 * two, and the drain is about to stop anyway.
 */
export const resolveOfflinePhase = ({
  online,
  syncing = false,
  justSyncedAt = null,
  now = Date.now(),
}) => {
  if (!online) return OFFLINE_PHASE.OFFLINE;
  if (syncing) return OFFLINE_PHASE.SYNCING;

  if (
    Number.isFinite(justSyncedAt) &&
    now - justSyncedAt < SYNCED_VISIBLE_MS
  ) {
    return OFFLINE_PHASE.SYNCED;
  }

  return OFFLINE_PHASE.HIDDEN;
};

/**
 * Phase + queue depth → everything the component renders.
 *
 * `tone` indexes the palette's status triads (`warningSurface` / `warningBorder`
 * / `warningText`), so the banner can never end up with a success background and
 * a warning glyph, and dark mode comes for free.
 *
 * `motion` names the right-hand icon's behaviour rather than describing it, so
 * the component decides how a "pulse" or a "spin" is actually drawn.
 */
export const describeOfflineStatus = (phase, { pending = 0 } = {}) => {
  switch (phase) {
    case OFFLINE_PHASE.OFFLINE:
      return {
        tone: "warning",
        icon: "cloud-offline-outline",
        // Amber, not red: being offline is a condition to be aware of, not a
        // failure. Nothing has gone wrong and nothing is lost.
        title: "You're offline",
        subtitle: pending
          ? `${plural(pending, "attendance record")} waiting to sync`
          : "Attendance will sync automatically when you're back online.",
        trailingIcon: "cloud-upload-outline",
        motion: "pulse",
      };

    case OFFLINE_PHASE.SYNCING:
      return {
        tone: "info",
        icon: "cloud-upload-outline",
        title: "Syncing attendance…",
        subtitle: pending
          ? `${plural(pending, "record")} remaining`
          : null,
        trailingIcon: "sync-outline",
        motion: "spin",
      };

    case OFFLINE_PHASE.SYNCED:
      return {
        tone: "success",
        icon: "checkmark-circle",
        title: "All attendance synced",
        subtitle: null,
        trailingIcon: null,
        motion: "none",
      };

    default:
      return null;
  }
};

/** One string for screen readers, since the row is two visual lines. */
export const describeOfflineStatusForA11y = (content) =>
  [content?.title, content?.subtitle].filter(Boolean).join(". ");

export default {
  OFFLINE_PHASE,
  SYNCED_VISIBLE_MS,
  describeOfflineStatus,
  describeOfflineStatusForA11y,
  resolveOfflinePhase,
};

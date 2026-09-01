import { format, formatDistanceStrict, isValid } from 'date-fns';

/**
 * "Which JS is this device actually running?"
 *
 * The native version (`1.2.0 (12)`) answers which *binary* is installed, and
 * that is the number everyone quotes — but OTA updates change the JS without
 * changing it. Two devices reporting `1.2.0 (12)` can be running code published
 * weeks apart, which makes "have you got the fix yet?" unanswerable and makes a
 * bug report ambiguous about what was even running.
 *
 * `expo-updates` already knows. Profile computed `updateId` and `runtimeVersion`
 * and then rendered neither; this turns what it knows into something a person
 * can read out over the phone.
 *
 * Pure and injectable so it can be tested without an OTA runtime — Profile
 * passes the `Updates.*` constants straight in.
 */

/** How the running bundle got onto the device. */
export const UPDATE_SOURCE = {
  /** Metro / a dev client. No update identity exists at all. */
  DEVELOPMENT: 'development',
  /** The bundle compiled into the binary. No OTA has been applied. */
  EMBEDDED: 'embedded',
  /** An OTA update, downloaded and applied. */
  OTA: 'ota',
};

/** `d MMM yyyy, hh:mm a`, or null for anything undateable. */
export function formatUpdateDate(value) {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date ? value : new Date(value);
  return isValid(date) ? format(date, 'd MMM yyyy, hh:mm a') : null;
}

/** "3 days ago". Null when undateable or in the future by more than a minute. */
export function formatUpdateAge(value, now = new Date()) {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (!isValid(date)) return null;

  // A published-in-the-future timestamp means the device clock is wrong, and
  // "in 3 hours" reads as a bug. Show nothing rather than something absurd.
  if (date.getTime() - now.getTime() > 60_000) return null;

  // `formatDistanceStrict`, not `formatDistanceToNowStrict`: the latter reads
  // the real clock and would ignore the injected `now`, making this untestable.
  return `${formatDistanceStrict(date, now)} ago`;
}

/** First 8 characters of the update UUID — enough to match against EAS. */
export function shortUpdateId(updateId) {
  if (typeof updateId !== 'string' || !updateId.trim()) return null;
  return updateId.trim().slice(0, 8);
}

/**
 * Describes the running bundle for display.
 *
 * @param {object} info
 * @param {string|null} [info.updateId]
 * @param {Date|string|number|null} [info.createdAt] when the update was published
 * @param {string|null} [info.channel]
 * @param {string|null} [info.runtimeVersion]
 * @param {boolean} [info.isEmbeddedLaunch] running the bundle inside the binary
 * @param {boolean} [info.isEnabled] whether expo-updates is active at all
 * @param {Date} [info.now] injected for tests
 * @returns {{source: string, label: string, detail: string|null,
 *            publishedAt: string|null, age: string|null,
 *            id: string|null, channel: string|null, runtimeVersion: string}}
 *          `label` is the headline value; `detail` is the supporting line, or
 *          null when there is nothing worth a second line.
 */
export function describeRunningUpdate({
  updateId = null,
  createdAt = null,
  channel = null,
  runtimeVersion = null,
  isEmbeddedLaunch = false,
  isEnabled = true,
  now = new Date(),
} = {}) {
  const publishedAt = formatUpdateDate(createdAt);
  const age = formatUpdateAge(createdAt, now);
  const id = shortUpdateId(updateId);
  // A dev build reports the channel as "" rather than null — the same reason
  // Profile uses `||` for it.
  const resolvedChannel = channel || null;
  const resolvedRuntime = runtimeVersion || 'unknown';

  const base = {
    publishedAt,
    age,
    id,
    channel: resolvedChannel,
    runtimeVersion: resolvedRuntime,
  };

  if (!isEnabled) {
    return {
      ...base,
      source: UPDATE_SOURCE.DEVELOPMENT,
      label: 'Development build',
      detail: 'Updates are disabled in this build',
    };
  }

  // `isEmbeddedLaunch` is the honest answer to "has this device taken an update
  // yet?". `createdAt` is still populated here — it is the build's own manifest
  // time — so the date is shown as supporting detail rather than as the
  // headline, where it would read as an OTA that never happened.
  if (isEmbeddedLaunch || !updateId) {
    return {
      ...base,
      source: UPDATE_SOURCE.EMBEDDED,
      label: 'Original build',
      detail: publishedAt ? `Built ${publishedAt}` : 'No update applied yet',
    };
  }

  return {
    ...base,
    source: UPDATE_SOURCE.OTA,
    label: publishedAt ?? 'Applied',
    // The two things support actually needs: which update, and from where.
    detail: [age, id && `ID ${id}`, resolvedChannel]
      .filter(Boolean)
      .join(' · '),
  };
}

export default {
  UPDATE_SOURCE,
  describeRunningUpdate,
  formatUpdateAge,
  formatUpdateDate,
  shortUpdateId,
};

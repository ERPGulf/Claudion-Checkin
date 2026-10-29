import { formatTime, getLanguage } from '../localization';

/**
 * Presentation helpers for the attendance-request fields.
 *
 * Read local wall-clock components before using the selected app locale. The
 * native Intl path previously resolved local values in UTC on some devices;
 * formatting a display-only UTC copy prevents that shift from returning.
 */

const cachedPrefers24Hour = new Map();

/**
 * Whether the selected app locale writes time on a 24-hour clock.
 *
 * Cached per language, so an in-app language switch uses the new hour cycle.
 * Falls back to 12-hour, which is what the rest of the app renders, so a device
 * with no usable Intl reads the same as Attendance History rather than flipping
 * to a format nothing else in the app uses.
 */
export function prefers24Hour() {
  const language = getLanguage();
  if (cachedPrefers24Hour.has(language)) return cachedPrefers24Hour.get(language);

  let prefers24Hour = false;
  try {
    const resolved = new Intl.DateTimeFormat(language, {
      hour: 'numeric',
    }).resolvedOptions();

    if (typeof resolved.hour12 === 'boolean') {
      prefers24Hour = !resolved.hour12;
    } else if (typeof resolved.hourCycle === 'string') {
      // h23/h24 are the 24-hour cycles; h11/h12 are the 12-hour ones.
      prefers24Hour = resolved.hourCycle.startsWith('h2');
    }
  } catch (error) {
    // Keep 12-hour. A display preference is not worth throwing over.
  }

  cachedPrefers24Hour.set(language, prefers24Hour);
  return prefers24Hour;
}

/**
 * "11:30 PM", or "23:30" where the locale expects a 24-hour clock.
 *
 * `use24Hour` is injectable so both branches are testable without reaching into
 * the cache or stubbing Intl.
 */
export function formatFieldTime(date, use24Hour = prefers24Hour()) {
  if (!date) return '--:--';
  const wallClock = new Date(Date.UTC(2000, 0, 1, date.getHours(), date.getMinutes()));
  return formatTime(wallClock, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: !use24Hour });
}

import { format } from 'date-fns';

/**
 * Presentation helpers for the attendance-request fields.
 *
 * Formatting goes through date-fns, which reads a Date's *local* components.
 * That matters: the screen previously formatted with `toLocaleTimeString`, whose
 * Intl path resolved a correct local Date in UTC — turning "now" into 5:30 AM on
 * a UTC+05:30 device. Only the hour *cycle* below consults Intl, and that is a
 * property of the locale rather than of the timezone, so the shift cannot return.
 */

let cachedPrefers24Hour;

/**
 * Whether this device's locale writes time on a 24-hour clock.
 *
 * Resolved once and cached — the answer cannot change without an app restart.
 * Falls back to 12-hour, which is what the rest of the app renders, so a device
 * with no usable Intl reads the same as Attendance History rather than flipping
 * to a format nothing else in the app uses.
 */
export function prefers24Hour() {
  if (cachedPrefers24Hour !== undefined) return cachedPrefers24Hour;

  cachedPrefers24Hour = false;
  try {
    const resolved = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
    }).resolvedOptions();

    if (typeof resolved.hour12 === 'boolean') {
      cachedPrefers24Hour = !resolved.hour12;
    } else if (typeof resolved.hourCycle === 'string') {
      // h23/h24 are the 24-hour cycles; h11/h12 are the 12-hour ones.
      cachedPrefers24Hour = resolved.hourCycle.startsWith('h2');
    }
  } catch (error) {
    // Keep 12-hour. A display preference is not worth throwing over.
  }

  return cachedPrefers24Hour;
}

/**
 * "11:30 PM", or "23:30" where the locale expects a 24-hour clock.
 *
 * `use24Hour` is injectable so both branches are testable without reaching into
 * the cache or stubbing Intl.
 */
export function formatFieldTime(date, use24Hour = prefers24Hour()) {
  if (!date) return '--:--';
  return format(date, use24Hour ? 'HH:mm' : 'hh:mm a');
}

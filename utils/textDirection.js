/**
 * Text-direction helpers.
 *
 * The app has no i18n layer, but user-supplied strings (employee names,
 * shortcut titles coming from Frappe) are frequently Arabic. These helpers
 * let a single <Text> align itself to the script it actually contains,
 * independently of the app's layout direction.
 */

// Hebrew, Arabic, Syriac, Thaana, NKo + Arabic Presentation Forms A/B.
const RTL_SCRIPT_RE = new RegExp(
  '[\\u0591-\\u07FF\\u0860-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]',
);

/** True when `value` contains at least one right-to-left character. */
export function isRtlText(value) {
  return typeof value === 'string' && RTL_SCRIPT_RE.test(value);
}

/**
 * `textAlign` for a string whose script is unknown at build time.
 * @param {string} value
 * @param {'left'|'center'|'right'} [fallback='left']
 */
export function resolveTextAlign(value, fallback = 'left') {
  return isRtlText(value) ? 'right' : fallback;
}

/** Initials for an avatar. Works for Arabic and Latin, max 2 glyphs. */
export function getInitials(value) {
  if (typeof value !== 'string') return '';
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Colour helpers.
 *
 * The palette in constants/theme.js is opaque hex, because every token there
 * names a surface, a line or a foreground — none of them need alpha. Atmospheric
 * layers do: a glow or a scrim is the *same* token at low opacity, and the whole
 * point of reading it off the palette is that it follows the theme instead of
 * being a second, hand-picked colour that quietly drifts from it.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Same colour, given an alpha channel.
 *
 * Accepts `#RGB` or `#RRGGBB` (with or without the `#`) and returns an
 * `rgba(...)` string. Anything already functional — `rgba(...)`, `transparent` —
 * is passed through untouched, so this is safe to wrap around a value that may
 * not be hex.
 *
 * @param {string} color a hex colour, typically a token off useAppTheme()
 * @param {number} alpha 0..1, clamped
 * @returns {string} `rgba(r, g, b, a)`
 */
export function withAlpha(color, alpha) {
  if (typeof color !== 'string') return color;

  const match = HEX_RE.exec(color.trim());
  if (!match) return color;

  let hex = match[1];
  // Expand the shorthand form so the byte parsing below is uniform.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default withAlpha;

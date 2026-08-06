// The default export is the Classic/Modern container, so Shortcut1, Shortcut2
// and Shortcut3 — and therefore every tenant-configured document behind them —
// pick up the right UI without any of the three screens changing.
//
// TEMPORARY (New Home Experience experiment): on removal, delete
// ShortcutDetailsContainer and ShortcutDetailsLegacy and default-export
// ShortcutDetailsModern directly.
import ShortcutDetails from './ShortcutDetailsContainer';
import ShortcutDetailsLegacy from './ShortcutDetailsLegacy';
import ShortcutDetailsModern from './ShortcutDetailsModern';

export { ShortcutDetailsLegacy, ShortcutDetailsModern };
export default ShortcutDetails;

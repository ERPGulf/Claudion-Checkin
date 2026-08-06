import React from "react";
import ToastBanner from "./ToastBanner";

/**
 * Toast type → tone and glyph.
 *
 * The keys are the contract with every `Toast.show({ type })` in the app and
 * must not change: `success`, `error` and `info` are the library's own names,
 * and `notificationToast` / `announcementToast` are what App.js's
 * `getForegroundToastType` and Profile's dev tester pass. Only what each one
 * *looks* like changed.
 *
 * Tones resolve through the palette, so every type has a light and a dark
 * treatment: green for success, red for error, blue for info, the brand orange
 * for a pushed notification and amber for an announcement. The glyphs are what
 * keep the last two apart at a glance — a bell versus a megaphone — since both
 * sit in the warm half of the palette.
 */
const TOAST_TYPES = {
  success: { tone: "success", icon: "checkmark-circle" },
  error: { tone: "error", icon: "close-circle" },
  info: { tone: "info", icon: "information-circle" },
  notificationToast: { tone: "accent", icon: "notifications" },
  announcementToast: { tone: "warning", icon: "megaphone" },
};

/**
 * The `config` prop handed to <Toast>.
 *
 * Every entry renders the same <ToastBanner>; the map above is the only thing
 * that differs between them, which is what stops the five types from drifting
 * apart the way five hand-styled blocks did. Each function receives the
 * library's full params object — `text1`, `text2`, `text1Style`, `text2Style`,
 * `onPress`, `hide`, `props` — and passes it straight through, so no call site
 * has to change.
 *
 * The dead `tomatoToast` entry that used to sit here is gone: it referenced
 * `View` and `Text` without importing them, so anything calling it would have
 * thrown. Nothing in the app ever did.
 */
export const toastConfig = Object.fromEntries(
  Object.entries(TOAST_TYPES).map(([type, { tone, icon }]) => [
    type,
    props => <ToastBanner {...props} tone={tone} icon={icon} />,
  ]),
);

export { TOAST_TYPES };

export default toastConfig;

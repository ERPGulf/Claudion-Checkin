import React from "react";
import Toast from "react-native-toast-message";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "../constants";
import { toastConfig } from "./Config";

/**
 * The app's single <Toast> host.
 *
 * Only the offset moved here; the instance, the `config` and every
 * `Toast.show()` call in the app are untouched, as is the library's own
 * slide-and-fade animation and swipe-to-dismiss.
 *
 * The offset now comes from the real safe-area inset. It used to be
 * `SIZES.topOffset + 55` on iOS, and `SIZES.topOffset` is
 * `StatusBar.currentHeight` — an Android-only API that is `undefined` on iOS, so
 * the iOS offset evaluated to `NaN` and the banner had nothing keeping it clear
 * of the notch or the Dynamic Island. `insets.top` is the measured inset on both
 * platforms, which is what those two need; the 8pt on top of it is the gap
 * between the status bar and the banner.
 */
function AppToast() {
  const insets = useSafeAreaInsets();

  return <Toast topOffset={insets.top + SPACING.sm} config={toastConfig} />;
}

export default AppToast;

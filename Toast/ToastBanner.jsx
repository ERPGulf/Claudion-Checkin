/* eslint-disable react/prop-types */
import React, { memo } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import PressableScale from "../components/common/PressableScale";
import { resolveTextAlign } from "../utils/textDirection";

/** Widths, not a fixed height — a long message grows the banner instead of clipping. */
const WIDTH = "92%";

/** Past this the banner stops growing, so it doesn't run edge to edge on a tablet. */
const MAX_WIDTH = 560;

/**
 * The app's toast, as one banner rendered for every type.
 *
 * Built from the same tokens as <StatusBanner> — the tinted `${tone}Surface`,
 * the `${tone}Border` hairline, the tone glyph, `TYPO` for the type and
 * `SHADOWS.card` for the lift — so a toast reads as the same material as the
 * cards it floats over, in whichever palette is active. Nothing here hardcodes a
 * colour: the old config painted five saturated blocks (`#22c55e`,
 * `rgb(239 68 68)`, `#0096FF`, …) with white centred text, which had no
 * relationship to the rest of the UI and no dark mode.
 *
 * Layout is horizontal and left-aligned: glyph, then title over message, then an
 * optional close button. Height is dynamic — the old style pinned it to 60pt,
 * which cut the second line off every message longer than a few words.
 *
 * Everything the library hands a custom toast is honoured, so no call site
 * changes: `text1` / `text2` are the title and message, `text1Style` /
 * `text2Style` still override them, `onPress` still makes the whole banner
 * tappable (the FCM foreground toast relies on it to open Notifications), and
 * `hide` backs the close button. The show/hide animation and swipe-to-dismiss
 * stay with the library's own AnimatedContainer.
 */
function ToastBanner({
  tone = "neutral",
  icon = "information-circle",
  text1,
  text2,
  text1Style,
  text2Style,
  onPress,
  hide,
}) {
  const { colors, isDark } = useAppTheme();

  const surface = colors[`${tone}Surface`] || colors.neutralSurface;
  const border = colors[`${tone}Border`] || colors.neutralBorder;
  const accent = colors[`${tone}Text`] || colors.textSecondary;

  const body = (
    <>
      <Ionicons
        name={icon}
        size={ICON.lg}
        color={accent}
        // Sits on the title's optical centre rather than the middle of a
        // three-line banner.
        style={{ marginTop: 1 }}
      />

      <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
        {!!text1 && (
          <Text
            style={[
              {
                ...TYPO.title3,
                color: accent,
                // Frappe titles and FCM payloads are regularly Arabic.
                textAlign: resolveTextAlign(text1),
              },
              text1Style,
            ]}
          >
            {text1}
          </Text>
        )}

        {!!text2 && (
          <Text
            style={[
              {
                ...TYPO.subhead,
                fontWeight: "400",
                color: colors.textSecondary,
                marginTop: text1 ? 2 : 0,
                textAlign: resolveTextAlign(text2),
              },
              text2Style,
            ]}
          >
            {text2}
          </Text>
        )}
      </View>

      {typeof hide === "function" && (
        <PressableScale
          onPress={hide}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={{
            width: 28,
            height: 28,
            borderRadius: RADIUS.pill,
            alignItems: "center",
            justifyContent: "center",
            marginStart: SPACING.sm,
          }}
        >
          <Ionicons name="close" size={ICON.sm} color={colors.textMuted} />
        </PressableScale>
      )}
    </>
  );

  const containerStyle = {
    width: WIDTH,
    maxWidth: MAX_WIDTH,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: surface,
    // A shadow over a near-black page is invisible, so dark mode leans on the
    // border and the surface step instead — the same rule <Card> follows.
    ...(isDark ? null : SHADOWS.card),
  };

  // Announced as a live region rather than waiting for focus: a toast that a
  // screen reader never reads is a toast that only sighted users get.
  const a11y = {
    accessible: true,
    accessibilityRole: "alert",
    accessibilityLiveRegion: "polite",
    accessibilityLabel: [text1, text2].filter(Boolean).join(". "),
  };

  // Only pressable when the caller gave it something to do, so a plain toast
  // doesn't advertise a tap that does nothing.
  if (typeof onPress === "function") {
    return (
      <PressableScale
        onPress={onPress}
        scaleTo={0.99}
        hitSlop={0}
        {...a11y}
        accessibilityRole="button"
        style={containerStyle}
      >
        {body}
      </PressableScale>
    );
  }

  return (
    <View {...a11y} style={containerStyle}>
      {body}
    </View>
  );
}

export default memo(ToastBanner);

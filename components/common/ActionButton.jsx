/* eslint-disable react/prop-types */
import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * Sizes. `lg` is for a screen's primary commitment (check in / check out);
 * `md` is the in-card default used on Profile.
 */
const SIZES = {
  md: { height: 48, radius: RADIUS.md, type: TYPO.headline, icon: ICON.sm },
  lg: { height: 54, radius: RADIUS.lg, type: TYPO.title3, icon: ICON.md },
};

/**
 * The app's button.
 *
 * `filled`   — the one primary action. Inverts per palette via `buttonFill`, so
 *              it is near-black on light and near-white on dark.
 * `accent`   — the brand teal as the action itself, for a screen whose whole job
 *              is one invitation (Login). Louder than `filled`, so a screen gets
 *              at most one. Do not hardcode its label colour: `accentFillText`
 *              is white on light (11.43:1 on the deep ink) and near-black on dark
 *              (11.28:1 on the mint), because the fill inverts between palettes.
 *              It used to be near-black in both, back when the fill was one
 *              orange — that rule died with the orange.
 * `outline`  — secondary. Card surface + hairline, so it reads as the same
 *              material as the cards around it, one step quieter than filled.
 * `tinted`   — semantic/status, driven by `tone` ('accent' | 'success' |
 *              'warning' | 'error' | 'info'). Note this is the *quiet* accent —
 *              a pale tint behind a dark label — not the same thing as `accent`.
 *
 * Deliberately not colour-coded by outcome: a filled button means "this is the
 * action", and the label says which. Reserve `tinted tone="error"` for genuinely
 * destructive things — ending a shift is routine, not destructive.
 */
function ActionButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  variant = 'filled',
  tone = 'accent',
  size = 'md',
  elevated = false,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const metrics = SIZES[size] || SIZES.md;

  const tinted = variant === 'tinted';
  const outline = variant === 'outline';
  const accent = variant === 'accent';
  const inert = disabled || loading;

  const foreground = inert
    ? colors.textMuted
    : tinted
      ? colors[`${tone}Text`]
      : outline
        ? colors.textPrimary
        : accent
          ? colors.accentFillText
          : colors.buttonFillText;

  const background = (() => {
    if (tinted) return colors[`${tone}Surface`];
    if (outline) return colors.cardBackground;
    if (inert) return colors.iconBackground;
    return accent ? colors.accentFill : colors.buttonFill;
  })();

  const border = (() => {
    if (tinted) return colors[`${tone}Border`];
    if (outline) return colors.cardBorder;
    // A disabled fill drops to `iconBackground`, which is a whisker away from
    // the page colour — the hairline is what keeps it legible as a control.
    return inert ? colors.cardBorder : null;
  })();

  return (
    <PressableScale
      onPress={onPress}
      disabled={inert}
      scaleTo={0.98}
      hitSlop={0}
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[
        {
          minHeight: metrics.height,
          borderRadius: metrics.radius,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: SPACING.md,
          paddingHorizontal: SPACING.lg,
          backgroundColor: background,
          ...(border ? { borderWidth: 1, borderColor: border } : null),
          // Shadows are invisible over a near-black page, so dark mode leans on
          // the surface step instead — same rule as <Card>.
          ...(elevated && !isDark && !inert ? SHADOWS.card : null),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={foreground}
          style={{ marginEnd: SPACING.sm }}
        />
      ) : (
        !!icon && (
          <Ionicons
            name={icon}
            size={metrics.icon}
            color={foreground}
            style={{ marginEnd: SPACING.sm }}
          />
        )
      )}
      <Text style={{ ...metrics.type, color: foreground }}>{label}</Text>
    </PressableScale>
  );
}

export default ActionButton;

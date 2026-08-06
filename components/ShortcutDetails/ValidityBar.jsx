/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/** Hairline-thin: a cue, not a gauge. */
const TRACK_HEIGHT = 6;

/**
 * How much of a document's validity is left, drawn as a bar.
 *
 * Two states, and the difference between them matters:
 *
 * **Measured** — `fraction` is a real number, computed from an issue date and an
 * expiry date the server actually sent (see `resolveValidityWindow`). The track
 * fills proportionally.
 *
 * **Neutral** — `fraction` is `null`, because the payload had no issue date to
 * measure a span against. The bar renders as a single flat rule at full width
 * rather than as an empty track: an unfilled gauge beside "100 days remaining"
 * would read as *nearly none left*, which is the opposite of the truth. Nothing
 * is estimated, and no start date is inferred from the countdown.
 *
 * Deliberately plain: no percentage label, no animation, no gradient. The colours
 * are the same `${tone}Border` / `${tone}Text` pair the badge above it uses, so
 * the bar can never disagree with the badge, and both resolve per palette.
 */
function ValidityBar({ tone = 'neutral', fraction = null, style }) {
  const { colors } = useAppTheme();

  const measured = typeof fraction === 'number' && Number.isFinite(fraction);
  const clamped = measured ? Math.min(1, Math.max(0, fraction)) : 1;

  const track = colors[`${tone}Border`] || colors.cardBorder;
  const fill = colors[`${tone}Text`] || colors.textMuted;

  return (
    <View
      accessible
      // Announced only when it means something. A neutral bar is decoration and
      // a screen reader should skip it — the day count beside it is the content.
      accessibilityRole={measured ? 'progressbar' : 'none'}
      accessibilityLabel={measured ? 'Validity remaining' : undefined}
      accessibilityValue={
        measured
          ? { min: 0, max: 100, now: Math.round(clamped * 100) }
          : undefined
      }
      importantForAccessibility={measured ? 'yes' : 'no-hide-descendants'}
      style={[
        {
          height: TRACK_HEIGHT,
          borderRadius: RADIUS.pill,
          backgroundColor: track,
          overflow: 'hidden',
          marginTop: SPACING.md,
        },
        style,
      ]}
    >
      {measured && (
        <View
          style={{
            width: `${clamped * 100}%`,
            height: '100%',
            borderRadius: RADIUS.pill,
            backgroundColor: fill,
            // Held back from the badge's full strength: this is the quietest
            // element in the card, and a solid bar at label weight would pull
            // the eye off the number it is describing.
            opacity: 0.65,
          }}
        />
      )}
    </View>
  );
}

export default ValidityBar;

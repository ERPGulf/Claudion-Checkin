/* eslint-disable react/prop-types */
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import useAppTheme from '../../hooks/useAppTheme';
import useReducedMotion from '../../hooks/useReducedMotion';
import AccentHalo from './AccentHalo';
import { BRAND_MARK_GLOW } from './BrandMark';

/**
 * The three fields, as fractions of the viewport.
 *
 * They are deliberately wider than the screen (negative `left`/`right`, and the
 * first and last hang off the top and bottom): a soft field whose falloff ends
 * inside the page has a visible edge, and an edge is the one thing atmosphere
 * must not have. Running the falloff past the sides means the only place it gets
 * cut is the screen boundary, where nothing can read it as a shape.
 *
 * They also overlap heavily — each one's span reaches well into its neighbour's.
 * Sized to their own thirds they left seams: every field is faintest at its own
 * edges, so three tidy bands put the weakest part of one against the weakest part
 * of the next and drew two pale stripes across the page. Overlapping means one
 * field is always at strength wherever another is fading, which is what makes the
 * result read as a single lit page rather than as three glows.
 *
 * All three are the mark's mint, and none of them is the brand orange. Warming
 * the bottom of the page towards the CTA was the obvious idea and it does not
 * survive contact with a near-white background: orange at any alpha you can see
 * composites to a pink-beige over #F4F5F7, so the page ended in a pink cloud —
 * the same wrong note the orange halo behind the logo struck, just spread wider.
 * One hue in the atmosphere also leaves the orange doing exactly one job on this
 * screen, which is the button.
 *
 * `drift` is how far the field wanders, as a fraction of the viewport, and `ms` is
 * one half of its cycle. The three periods are mutual non-multiples on purpose:
 * they beat against each other, so the composite never visibly repeats and the
 * page cannot settle into a pulse you can count. `delay` staggers their starts so
 * they do not all set off from the same corner at once.
 */
const FIELDS = [
  {
    key: 'crown',
    rect: { top: '-14%', height: '46%', left: '-45%', right: '-15%' },
    intensity: { light: 0.13, dark: 0.18 },
    drift: { x: 0.07, y: 0.02 },
    ms: 9000,
    delay: 0,
  },
  {
    key: 'hero',
    rect: { top: '14%', height: '50%', left: '-30%', right: '-30%' },
    intensity: { light: 0.21, dark: 0.29 },
    drift: { x: 0.05, y: 0.025 },
    ms: 11000,
    delay: 1400,
  },
  {
    key: 'base',
    rect: { top: '46%', height: '66%', left: '-25%', right: '-25%' },
    intensity: { light: 0.15, dark: 0.2 },
    drift: { x: 0.06, y: 0.02 },
    ms: 13000,
    delay: 2600,
  },
];

/**
 * The welcome screen's atmosphere: soft colour fields covering the whole page,
 * drifting and breathing slowly enough that you notice the page is alive without
 * ever catching the motion itself.
 *
 * This replaced two halos — one tight behind the logo, one under the CTA. They
 * lit the two things they sat behind and left everything between them flat, so
 * the page read as two glowing objects on a grey sheet rather than as a lit room.
 * Filling the background is what makes the difference; the logo still gets its
 * glow, it just comes from the field now instead of from a shape parked behind it.
 *
 * Built out of <AccentHalo>, which is the soft-blob primitive: stacked translucent
 * layers, no gradient library. Each field is a halo in an oversized box, with this
 * component moving the box and the halo breathing inside it.
 *
 * The falloff stays hand-built even though the welcome screen now carries
 * `expo-blur` over the top of this: the blur is a separate layer with a separate
 * job, it is a no-op on Android (see the note at the <BlurView>), and leaning on
 * it for the *shape* of these fields would make them flat rectangles anywhere it
 * does not blur. What this draws has to look right on its own.
 *
 * One hue throughout — the wordmark's own mint (see BRAND_MARK_GLOW). The
 * atmosphere is the brand's colour; the orange is the button's, and nothing
 * else's. See FIELDS for why the warm variant did not survive.
 *
 * Purely decorative — no touch target, hidden from screen readers, and completely
 * still under reduce motion.
 */
function ShimmerField() {
  const { isDark } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const scheme = isDark ? 'dark' : 'light';

  // One value per field, each parked at 0.5 — the centre of its travel, which is
  // also exactly where a still field should sit under reduce motion.
  const drifts = useRef(FIELDS.map(() => new Animated.Value(0.5))).current;

  useEffect(() => {
    if (reduceMotion) {
      drifts.forEach(value => value.setValue(0.5));
      return undefined;
    }

    const animations = FIELDS.map((field, i) => {
      const half = toValue =>
        Animated.timing(drifts[i], {
          toValue,
          duration: field.ms,
          // Sinusoidal both ways: the turn at each end has no stop in it, so the
          // travel reads as one continuous wander rather than a shuttle.
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        });

      // The stagger sits outside the loop — inside, it would re-arm every cycle
      // and become a pause rather than an offset.
      return Animated.sequence([
        Animated.delay(field.delay),
        Animated.loop(Animated.sequence([half(0), half(1)])),
      ]);
    });

    animations.forEach(animation => animation.start());
    return () => animations.forEach(animation => animation.stop());
  }, [reduceMotion, drifts]);

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {FIELDS.map((field, i) => {
        // Travel is a fraction of the viewport, not a fixed number of pixels, so
        // the wander is the same gesture on a 320dp phone and on a tablet.
        const span = distance =>
          drifts[i].interpolate({
            inputRange: [0, 1],
            outputRange: [-distance, distance],
          });

        return (
          <Animated.View
            key={field.key}
            style={{
              position: 'absolute',
              ...field.rect,
              transform: reduceMotion
                ? undefined
                : [
                    { translateX: span(width * field.drift.x) },
                    // Vertical travel is a fraction of the horizontal (see
                    // FIELDS): a field that wanders as far up as it does sideways
                    // reads as floating, which is a busier effect than this
                    // screen wants.
                    { translateY: span(height * field.drift.y) },
                  ],
            }}
          >
            <AccentHalo
              color={BRAND_MARK_GLOW}
              intensity={field.intensity[scheme]}
              wave
              waveDelay={field.delay}
            />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

export default memo(ShimmerField);

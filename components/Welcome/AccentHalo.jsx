/* eslint-disable react/prop-types */
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { RADIUS } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useReducedMotion from '../../hooks/useReducedMotion';
import { withAlpha } from '../../utils/color';

/**
 * How many stacked layers make the falloff, and how much each one shrinks.
 *
 * These two are the whole trick, and they were tuned against a device rather than
 * guessed: at 6 layers × 0.82 the steps were plainly visible as concentric
 * stadiums. Fourteen layers at 0.92 puts each edge about one percent of alpha
 * away from its neighbour, which is below the threshold where a flat colour step
 * reads as an edge — so the same technique goes from "banded" to "bloom". They
 * are only background-colour views, so the extra eight cost nothing measurable.
 */
const LAYERS = 14;
const STEP = 0.92;

/**
 * The wave: one half-cycle, and the two ranges it drives.
 *
 * Slow and shallow on purpose. A glow that breathes at a rate you can *count* is
 * a loading indicator, and one that swings far enough to notice the extremes is a
 * distraction on a screen whose whole job is one button. At ~3s a side and a
 * quarter-stop of opacity, it reads as the page being alive rather than as
 * something happening — which is the only thing ambient motion should ever do.
 *
 * The scale never goes **above** 1. Layer 0 fills the parent box exactly, and
 * Android clips absolutely-positioned children to the parent rect, so a bloom
 * that swelled past its container would not spread — it would grow a hard
 * rectangular edge, on one platform only. Breathing inward is the same motion
 * with none of that risk.
 */
const WAVE_MS = 3000;
const WAVE_OPACITY = [0.72, 1];
const WAVE_SCALE = [0.94, 1];

/**
 * A soft accent glow — the atmospheric layer behind the logo and the CTA.
 *
 * There is no gradient library in this project, and adding one is not an option:
 * `expo-linear-gradient` and `expo-blur` are native modules, so a JS bundle that
 * imported one would crash every already-installed build the moment it arrived
 * over OTA, and this screen ships over OTA (that is what `BUILD_TAG` exists to
 * prove). It also would not help much — both are linear, and this wants a radial
 * falloff.
 *
 * So the glow is built the way it can be built with nothing but views:
 * concentric stadium-shaped layers of the same colour at a low alpha, largest
 * first. Alpha composites multiplicatively, so the centre accumulates all six
 * layers while the edge carries one, and the result is a smooth radial-ish
 * falloff for the cost of six background-only views. `intensity` is the alpha the
 * *centre* should reach; the per-layer alpha is solved backwards from it, so
 * changing the layer count does not change how strong the glow looks.
 *
 * Sizing is entirely in percentages of the parent, so the caller positions the
 * glow just by giving its container padding — no measurement, no magic offsets,
 * and every layer stays inside the parent's bounds, which matters because Android
 * clips absolutely-positioned children to the parent rect.
 *
 * The colour defaults to the palette (`primary2`, the brand teal) rather than a
 * hand-picked warm tone, so it tracks the theme. `color` overrides it where the
 * glow belongs to something that is not the brand accent — the welcome screen's
 * hero passes the wordmark's own mint, because a glow behind a logo has to be a
 * colour that logo could have cast.
 *
 * `wave` turns on a slow breathing loop, and `waveDelay` offsets its phase so two
 * halos on one page swell in turn rather than in lockstep. Off by default: this
 * component is also used as still atmosphere, and ambient motion is something a
 * screen should opt into. It respects reduce-motion on its own rather than
 * trusting each caller to remember — see the effect.
 *
 * Purely decorative: no touch target, and hidden from screen readers.
 */
function AccentHalo({ intensity = 0.2, color, wave = false, waveDelay = 0 }) {
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();

  const base = color || colors.primary2;

  // Solve the per-layer alpha so LAYERS of it compose to `intensity`.
  const perLayer = 1 - Math.pow(1 - intensity, 1 / LAYERS);
  const fill = withAlpha(base, perLayer);

  /* ---------- The wave ---------- */
  /* Core Animated on the native driver, like every other animation in the app —
     opacity and transform are both native-drivable, so the whole loop runs off
     the JS thread and keeps costing nothing while it is on screen. */
  const breathe = useRef(new Animated.Value(1)).current;
  const animate = wave && !reduceMotion;

  useEffect(() => {
    if (!animate) return undefined;

    const half = toValue =>
      Animated.timing(breathe, {
        toValue,
        duration: WAVE_MS,
        // Sinusoidal in and out: no stop at the turn, so the two halves read as
        // one continuous swell instead of a bounce.
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });

    // The delay sits *outside* the loop. Inside it would re-arm every cycle and
    // turn a phase offset into a pause — the offset only has to happen once, to
    // put two halos on the same page out of step.
    const animation = Animated.sequence([
      Animated.delay(waveDelay),
      Animated.loop(Animated.sequence([half(0), half(1)])),
    ]);

    animation.start();
    return () => {
      animation.stop();
      // Back to the settled state, so a halo that stops animating is the same
      // halo it would have been had it never started.
      breathe.setValue(1);
    };
  }, [animate, waveDelay, breathe]);

  /* Applied only when the wave is running. Interpolating a parked value would
     leave a still halo sitting at the bottom of the range — dimmer and smaller
     than the one it is supposed to be — which is exactly the wrong outcome under
     reduce motion. */
  const waveStyle = animate
    ? {
        opacity: breathe.interpolate({
          inputRange: [0, 1],
          outputRange: WAVE_OPACITY,
        }),
        transform: [
          {
            scale: breathe.interpolate({
              inputRange: [0, 1],
              outputRange: WAVE_SCALE,
            }),
          },
        ],
      }
    : null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, waveStyle]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {Array.from({ length: LAYERS }, (_, i) => {
        // Layer 0 fills the box; each one after it insets by an equal share on
        // every side, which keeps them concentric whatever the box's aspect is.
        const scale = Math.pow(STEP, i);
        const inset = `${((1 - scale) / 2) * 100}%`;

        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: inset,
              bottom: inset,
              left: inset,
              right: inset,
              borderRadius: RADIUS.pill,
              backgroundColor: fill,
            }}
          />
        );
      })}
    </Animated.View>
  );
}

export default memo(AccentHalo);

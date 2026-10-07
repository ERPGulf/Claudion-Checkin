/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import useReducedMotion from '../../hooks/useReducedMotion';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Fades its child in the first time that child is seen, and never again.
 *
 * Opacity only: a translate here would put the elevated card inside a
 * transformed ancestor, which Android draws as a rectangular shadow plate.
 * Under reduced motion every row renders at its final opacity.
 *
 * The "never again" is the whole point. A FlatList unmounts rows that scroll far
 * enough out of the window and mounts them back on the way up, so an animation
 * keyed on mount alone would replay every time the user scrolled past — the
 * flashing this is meant to avoid. `seen` is a Set owned by the screen and
 * shared by every row: a card that has already appeared renders at its final
 * opacity on the very first frame, with no animation scheduled at all.
 *
 * The result is that only genuinely new rows — the ones a page reveal just
 * appended — move.
 */
function AppearingItem({ itemKey, seen, children }) {
  const reduceMotion = useReducedMotion();

  // Read once, at mount, before the effect below marks this key. `useState`'s
  // initialiser runs a single time, so a re-render can't flip an appearing row
  // into an instant one halfway through its animation.
  const [isNew] = useState(() => !seen.has(itemKey));

  const progress = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    seen.add(itemKey);

    if (!isNew) return undefined;

    // The setting is read asynchronously, so it can arrive mid-fade; jump to
    // the end rather than swapping the wrapper, which would remount the row.
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: EASE_OUT,
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [isNew, itemKey, seen, progress, reduceMotion]);

  // Nothing to animate: render a plain wrapper rather than an Animated.View, so
  // a long-scrolled list isn't carrying an animated node per row.
  if (!isNew) return children;

  return <Animated.View style={{ opacity: progress }}>{children}</Animated.View>;
}

export default AppearingItem;

/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/**
 * Fades and lifts its child in the first time that child is seen, and never
 * again.
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
  // Read once, at mount, before the effect below marks this key. `useState`'s
  // initialiser runs a single time, so a re-render can't flip an appearing row
  // into an instant one halfway through its animation.
  const [isNew] = useState(() => !seen.has(itemKey));

  const progress = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    seen.add(itemKey);

    if (!isNew) return undefined;

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [isNew, itemKey, seen, progress]);

  // Nothing to animate: render a plain wrapper rather than an Animated.View, so
  // a long-scrolled list isn't carrying an animated node per row.
  if (!isNew) return children;

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default AppearingItem;

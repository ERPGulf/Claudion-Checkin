import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the OS asks for reduced motion ("Reduce Motion" on iOS, "Remove
 * animations" on Android).
 *
 * Any screen that animates on mount should gate on this and jump straight to the
 * finished state instead — for some people motion is not decoration, it is
 * nausea. Decorative loops and loading pulses also use this setting, keeping
 * their static content visible when animation is disabled.
 *
 * Reads the current value once and then listens, because the user can flip the
 * setting while the app is open.
 *
 * @returns {boolean}
 */
export default function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (mounted) setReduced(!!value);
      })
      // Not worth surfacing: a failed probe just means animations stay on.
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => setReduced(!!value),
    );

    return () => {
      mounted = false;
      // RN 0.65+ returns a subscription; older shapes exposed `remove` on the
      // module instead. Guard so this cannot throw on teardown.
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}

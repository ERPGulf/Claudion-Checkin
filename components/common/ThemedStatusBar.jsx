import React from 'react';
import { StatusBar } from 'expo-status-bar';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * Status bar tied to the *resolved* app theme rather than the OS appearance.
 *
 * `style="auto"` reads the OS setting directly, which is wrong whenever the two
 * disagree: on a dark-mode device showing the light-only legacy Home, "auto"
 * paints light glyphs onto a light background. Deriving it from useAppTheme()
 * keeps them in step.
 */
function ThemedStatusBar() {
  const { isDark } = useAppTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

export default ThemedStatusBar;

/* eslint-disable react/prop-types */
import React from "react";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from "../hooks/useHomeExperience";
import WelcomeScreenLegacy from "./WelcomeScreenLegacy";
import WelcomeScreenModern from "./WelcomeScreenModern";

/**
 * Picks the Classic or Modern Welcome / Get Started UI off the "Enable Modern UI"
 * toggle.
 *
 * The switch lives here rather than in `navigation/auth-navigator.jsx`, which is
 * where the app navigator puts every other screen's switch, for two reasons: the
 * auth stack has no legacy/modern pairs yet, so there is no existing branch to
 * extend, and `welcome` is the stack's `initialRouteName` — the first thing that
 * renders on a cold start. Switching inside the component keeps the navigator and
 * the startup path byte-identical, so nothing about which route mounts first, or
 * with what options, depends on a device preference. Same reasoning as
 * <ShortcutDetailsContainer>.
 *
 * Props pass straight through: this is a drop-in for what `screens/index.js`
 * already exported as `WelcomeScreen`, so neither the navigator nor the barrel
 * changed.
 *
 * On removal: delete this file plus WelcomeScreenLegacy.jsx, and rename
 * WelcomeScreenModern.jsx to WelcomeScreen.jsx.
 */
function WelcomeScreen(props) {
  const { enabled: newHomeEnabled } = useHomeExperience();

  return newHomeEnabled ? (
    <WelcomeScreenModern {...props} />
  ) : (
    <WelcomeScreenLegacy {...props} />
  );
}

export default WelcomeScreen;

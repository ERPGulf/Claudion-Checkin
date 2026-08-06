/* eslint-disable react/prop-types */
import React from "react";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from "../hooks/useHomeExperience";
import LoginLegacy from "./LoginLegacy";
import LoginModern from "./LoginModern";

/**
 * Picks the Classic or Modern Login UI off the "Enable Modern UI" toggle.
 *
 * The switch lives here rather than in `navigation/auth-navigator.jsx` for the
 * same reason <WelcomeScreen> and <QrScan> do it here: the auth stack has no
 * legacy/modern pairs to extend, and keeping the branch inside the component
 * leaves the navigator untouched — `login` is what the QR scanner navigates to
 * on a good scan, and it does not need to know which UI is active.
 *
 * Props pass straight through, so this is a drop-in for what `screens/index.js`
 * already exported as `Login`.
 *
 * On removal: delete this file plus LoginLegacy.jsx, and rename LoginModern.jsx
 * to Login.jsx.
 */
function Login(props) {
  const { enabled: newHomeEnabled } = useHomeExperience();

  return newHomeEnabled ? (
    <LoginModern {...props} />
  ) : (
    <LoginLegacy {...props} />
  );
}

export default Login;

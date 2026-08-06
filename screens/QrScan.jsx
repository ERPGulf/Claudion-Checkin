/* eslint-disable react/prop-types */
import React from "react";
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from "../hooks/useHomeExperience";
import QrScanLegacy from "./QrScanLegacy";
import QrScanModern from "./QrScanModern";

/**
 * Picks the Classic or Modern Scan QR Code UI off the "Enable Modern UI" toggle.
 *
 * The switch lives here rather than in `navigation/auth-navigator.jsx` for the
 * same reason <WelcomeScreen> does it here: the auth stack has no legacy/modern
 * pairs to extend, and keeping the branch inside the component leaves the
 * navigator and the provisioning route untouched — `Qrscan` is what both the
 * welcome screen and the login screen navigate to, and neither needs to know
 * which UI is active.
 *
 * Props pass straight through, so this is a drop-in for what `screens/index.js`
 * already exported as `QrScan`.
 *
 * On removal: delete this file plus QrScanLegacy.jsx, and rename
 * QrScanModern.jsx to QrScan.jsx.
 */
function QrScan(props) {
  const { enabled: newHomeEnabled } = useHomeExperience();

  return newHomeEnabled ? (
    <QrScanModern {...props} />
  ) : (
    <QrScanLegacy {...props} />
  );
}

export default QrScan;

/* eslint-disable react/prop-types */
import React from 'react';
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from '../../hooks/useHomeExperience';
import ShortcutDetailsLegacy from './ShortcutDetailsLegacy';
import ShortcutDetailsModern from './ShortcutDetailsModern';

/**
 * Picks the Classic or Modern document detail UI off the "Enable Modern UI"
 * toggle.
 *
 * The switch lives in a container here rather than in `navigation/
 * app-navigator.jsx`, which is where every other screen's switch lives, because
 * this one isn't a screen. Shortcut1, Shortcut2 and Shortcut3 are three separate
 * routes that all render this one component — and between them they cover every
 * document the tenant configures, since the title and the fields both come from
 * the server. Switching here means all three routes get the redesign from a
 * single decision, with no change to any of them and no per-screen duplication.
 * Switching in the navigator would have meant three near-identical pairs.
 *
 * The props are the component's original contract — `title`, `data`, `loading`
 * — passed straight through untouched, so this is a drop-in for what
 * `components/ShortcutDetails/index.js` used to export.
 */
function ShortcutDetailsContainer(props) {
  const { enabled: newHomeEnabled } = useHomeExperience();

  return newHomeEnabled ? (
    <ShortcutDetailsModern {...props} />
  ) : (
    <ShortcutDetailsLegacy {...props} />
  );
}

export default ShortcutDetailsContainer;

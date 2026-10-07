/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';

const format = (startTime) => {
  const seconds = startTime
    ? Math.max(0, Math.floor((Date.now() - startTime) / 1000))
    : 0;
  const pad = (n) => String(n).padStart(2, '0');

  return `${pad(Math.floor(seconds / 3600))}:${pad(
    Math.floor((seconds % 3600) / 60),
  )}:${pad(seconds % 60)}`;
};

/**
 * The running break time as HH:MM:SS. Renders a bare string, so it must sit
 * inside a <Text> — the caller owns the typography.
 *
 * Ticks on its own so only this text re-renders each second, not the screen.
 * The 2-hour auto-end stays in useAttendanceAction; this is display only.
 */
function BreakClock({ startTime }) {
  const [label, setLabel] = useState(() => format(startTime));

  useEffect(() => {
    setLabel(format(startTime));
    if (!startTime) return undefined;

    const id = setInterval(() => setLabel(format(startTime)), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return label;
}

export default BreakClock;

export const BREAK_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export const getTodayString = () =>
  new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

export const isBreakCompleted = (breakData) => {
  if (!breakData?.breaks?.length) return false;

  const hasIn = breakData.breaks.some((b) => b.start);
  const hasOut = breakData.breaks.some((b) => b.end);

  return hasIn && hasOut;
};

export const findOpenBreak = (breakData) => {
  const breaks = breakData?.breaks ?? [];
  for (let i = breaks.length - 1; i >= 0; i -= 1) {
    const currentBreak = breaks[i];
    if (!currentBreak?.end) return currentBreak;
  }
  return null;
};

export const formatSecondsToHms = (seconds) => {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  return `${hrs}:${mins}:${secs}`;
};

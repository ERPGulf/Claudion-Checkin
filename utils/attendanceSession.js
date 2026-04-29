import AsyncStorage from "@react-native-async-storage/async-storage";

export const CHECKIN_START_TIME_KEY = "checkinStartTime";
export const LAST_CHECKOUT_TIME_KEY = "lastCheckoutTime";

const STATUS_CHECKIN_FIELDS = [
  "checkin_time",
  "checkinTime",
  "latest_checkin_time",
  "latestCheckinTime",
  "timestamp",
  "time",
  "creation",
];

const normalizeEpochMs = (value) => {
  if (!Number.isFinite(value) || value <= 0) return null;

  // Handle unix seconds from APIs by promoting to milliseconds.
  if (value < 1e12) {
    return value * 1000;
  }

  return value;
};

export const normalizeCustomIn = (customIn) => {
  if (customIn === true || customIn === 1 || customIn === "1") {
    return 1;
  }

  return 0;
};

export const toTimestampMs = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return normalizeEpochMs(value.getTime());
  }

  if (typeof value === "number") {
    return normalizeEpochMs(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      return normalizeEpochMs(Number(trimmed));
    }

    const parsed = Date.parse(trimmed);
    return normalizeEpochMs(parsed);
  }

  return null;
};

export const getStatusCheckinTime = (status) => {
  for (const field of STATUS_CHECKIN_FIELDS) {
    const parsed = toTimestampMs(status?.[field]);
    if (parsed) return parsed;
  }

  return null;
};

const isValidSessionStart = (candidate, lastCheckoutTime, nowMs) => {
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return false;
  }

  if (Number.isFinite(lastCheckoutTime) && candidate <= lastCheckoutTime) {
    return false;
  }

  // Reject future timestamps caused by device/server skew.
  if (candidate > nowMs + 60 * 1000) {
    return false;
  }

  return true;
};

export const resolveActiveSessionStart = ({
  status,
  storedCheckinStartTime,
  reduxCheckinTime,
  lastCheckoutTime,
  nowMs = Date.now(),
}) => {
  if (normalizeCustomIn(status?.custom_in) !== 1) {
    return null;
  }

  const parsedLastCheckoutTime = toTimestampMs(lastCheckoutTime);
  const candidates = [
    getStatusCheckinTime(status),
    toTimestampMs(storedCheckinStartTime),
    toTimestampMs(reduxCheckinTime),
  ].filter((candidate) =>
    isValidSessionStart(candidate, parsedLastCheckoutTime, nowMs),
  );

  if (!candidates.length) {
    return null;
  }

  return Math.max(...candidates);
};

export const getPersistedSessionTimes = async () => {
  const [storedCheckinStartTime, storedLastCheckoutTime] = await Promise.all([
    AsyncStorage.getItem(CHECKIN_START_TIME_KEY),
    AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY),
  ]);

  return {
    checkinStartTime: toTimestampMs(storedCheckinStartTime),
    lastCheckoutTime: toTimestampMs(storedLastCheckoutTime),
  };
};

export const persistCheckinStartTime = async (checkinStartTime) => {
  const resolvedStart = toTimestampMs(checkinStartTime) ?? Date.now();

  await AsyncStorage.setItem(CHECKIN_START_TIME_KEY, String(resolvedStart));

  return resolvedStart;
};

export const clearPersistedCheckinStartTime = async () => {
  await AsyncStorage.removeItem(CHECKIN_START_TIME_KEY);
};

export const persistCheckoutTime = async (checkoutTime = Date.now()) => {
  const resolvedCheckout = toTimestampMs(checkoutTime) ?? Date.now();

  await Promise.all([
    AsyncStorage.setItem(LAST_CHECKOUT_TIME_KEY, String(resolvedCheckout)),
    AsyncStorage.removeItem(CHECKIN_START_TIME_KEY),
  ]);

  return resolvedCheckout;
};

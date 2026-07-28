import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clearProcessedEventMark,
  evaluatePendingEvent,
  getLastProcessedEventAt,
  LAST_PROCESSED_EVENT_KEY,
  markEventProcessed,
  MAX_REPLAY_AGE_MS,
  PENDING_EVENT,
} from "../utils/geofenceEventLog";

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const minutesAgo = (minutes) => NOW - minutes * 60 * 1000;

describe("geofence pending-event bookkeeping", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe("evaluatePendingEvent", () => {
    it("replays an EXIT that native recorded while JS was not running", () => {
      const occurredAt = minutesAgo(45);

      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "EXIT", timestamp: occurredAt },
          lastProcessedAt: null,
          nowMs: NOW,
        }),
      ).toEqual({
        status: PENDING_EVENT.READY,
        type: "OUT",
        occurredAt,
      });
    });

    it("maps ENTER to a check-in", () => {
      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "ENTER", timestamp: minutesAgo(5) },
          lastProcessedAt: null,
          nowMs: NOW,
        }).type,
      ).toBe("IN");
    });

    it("ignores an event JS has already handled", () => {
      const occurredAt = minutesAgo(45);

      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "EXIT", timestamp: occurredAt },
          lastProcessedAt: occurredAt,
          nowMs: NOW,
        }).status,
      ).toBe(PENDING_EVENT.NONE);
    });

    it("replays an event newer than the last handled one", () => {
      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "EXIT", timestamp: minutesAgo(10) },
          lastProcessedAt: minutesAgo(300),
          nowMs: NOW,
        }).status,
      ).toBe(PENDING_EVENT.READY);
    });

    it("returns NONE when native has no record", () => {
      expect(
        evaluatePendingEvent({ lastEvent: null, lastProcessedAt: null }).status,
      ).toBe(PENDING_EVENT.NONE);
    });

    it("ignores transitions it cannot map", () => {
      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "DWELL", timestamp: minutesAgo(1) },
          lastProcessedAt: null,
          nowMs: NOW,
        }).status,
      ).toBe(PENDING_EVENT.NONE);
    });

    it("expires an event older than the replay window instead of acting on it", () => {
      const result = evaluatePendingEvent({
        lastEvent: {
          transition: "EXIT",
          timestamp: NOW - MAX_REPLAY_AGE_MS - 1000,
        },
        lastProcessedAt: null,
        nowMs: NOW,
      });

      expect(result.status).toBe(PENDING_EVENT.EXPIRED);
      expect(result.occurredAt).toBeGreaterThan(0);
    });

    it("expires an event dated in the future (device clock moved)", () => {
      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "EXIT", timestamp: NOW + 10 * 60 * 1000 },
          lastProcessedAt: null,
          nowMs: NOW,
        }).status,
      ).toBe(PENDING_EVENT.EXPIRED);
    });

    it("tolerates a few seconds of clock skew", () => {
      expect(
        evaluatePendingEvent({
          lastEvent: { transition: "EXIT", timestamp: NOW + 5000 },
          lastProcessedAt: null,
          nowMs: NOW,
        }).status,
      ).toBe(PENDING_EVENT.READY);
    });
  });

  describe("high-water mark", () => {
    it("round-trips the newest handled event", async () => {
      await markEventProcessed(minutesAgo(5));
      expect(await getLastProcessedEventAt()).toBe(minutesAgo(5));
    });

    it("never moves backwards", async () => {
      await markEventProcessed(minutesAgo(5));
      await markEventProcessed(minutesAgo(60));

      expect(await getLastProcessedEventAt()).toBe(minutesAgo(5));
    });

    it("ignores an unusable timestamp", async () => {
      await markEventProcessed(null);
      expect(await AsyncStorage.getItem(LAST_PROCESSED_EVENT_KEY)).toBeNull();
    });

    it("reports nothing handled on a fresh install", async () => {
      expect(await getLastProcessedEventAt()).toBeNull();
    });

    it("clears the mark", async () => {
      await markEventProcessed(minutesAgo(5));
      await clearProcessedEventMark();

      expect(await getLastProcessedEventAt()).toBeNull();
    });
  });
});

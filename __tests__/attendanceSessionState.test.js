import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CHECKIN_START_TIME_KEY,
  LAST_CHECKOUT_TIME_KEY,
} from "../utils/attendanceSession";
import {
  canTransition,
  clearSessionState,
  performSessionTransition,
  readSession,
  reconcileSessionFromServer,
  SESSION_ORIGIN,
  SESSION_STATE_KEY,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";

const ok = () => ({ allowed: true, name: "EMP-CHKIN-001" });

/** Puts the machine in CHECKED_IN via a successful transition. */
const checkIn = (origin) =>
  performSessionTransition({ type: "IN", origin, execute: ok });

describe("attendance session state machine", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe("transition rules", () => {
    it("allows IN only when no session is open", () => {
      expect(canTransition({ status: SESSION_STATUS.CHECKED_OUT }, "IN")).toBe(
        true,
      );
      expect(canTransition({ status: SESSION_STATUS.CHECKED_IN }, "IN")).toBe(
        false,
      );
    });

    it("allows OUT only when a session is open", () => {
      expect(canTransition({ status: SESSION_STATUS.CHECKED_IN }, "OUT")).toBe(
        true,
      );
      expect(canTransition({ status: SESSION_STATUS.CHECKED_OUT }, "OUT")).toBe(
        false,
      );
    });
  });

  it("starts checked out on a fresh install", async () => {
    const session = await readSession();
    expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(session.origin).toBeNull();
  });

  it("records the origin of a manual check-in and syncs the legacy start key", async () => {
    const outcome = await checkIn(SESSION_ORIGIN.MANUAL);

    expect(outcome.status).toBe(TRANSITION_RESULT.COMPLETED);
    expect(outcome.session).toMatchObject({
      status: SESSION_STATUS.CHECKED_IN,
      origin: SESSION_ORIGIN.MANUAL,
    });
    expect(outcome.session.startedAt).toBeGreaterThan(0);

    expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBe(
      String(outcome.session.startedAt),
    );
  });

  // Scenario 2: manual check-in, then the geofence closes the session.
  it("lets an automatic check-out close a manually started session", async () => {
    await checkIn(SESSION_ORIGIN.MANUAL);

    const execute = jest.fn(ok);
    const outcome = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe(TRANSITION_RESULT.COMPLETED);
    expect(outcome.previousSession.origin).toBe(SESSION_ORIGIN.MANUAL);
    expect(outcome.session).toMatchObject({
      status: SESSION_STATUS.CHECKED_OUT,
      origin: SESSION_ORIGIN.MANUAL,
      closedBy: SESSION_ORIGIN.AUTO,
    });

    expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY)).toBe(
      String(outcome.session.endedAt),
    );
  });

  // Scenario 1: the user checked out by hand before leaving the office.
  it("skips the automatic check-out after a manual one, without calling the API", async () => {
    await checkIn(SESSION_ORIGIN.MANUAL);
    await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.MANUAL,
      execute: ok,
    });

    const execute = jest.fn(ok);
    const outcome = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      execute,
    });

    expect(outcome.status).toBe(TRANSITION_RESULT.SKIPPED);
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.session.closedBy).toBe(SESSION_ORIGIN.MANUAL);
  });

  it("skips a check-in while a session is already open", async () => {
    await checkIn(SESSION_ORIGIN.MANUAL);

    const execute = jest.fn(ok);
    const outcome = await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      execute,
    });

    expect(outcome.status).toBe(TRANSITION_RESULT.SKIPPED);
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.session.origin).toBe(SESSION_ORIGIN.MANUAL);
  });

  it("serializes concurrent check-outs so only one log is sent", async () => {
    await checkIn(SESSION_ORIGIN.AUTO);

    const execute = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(ok()), 10)),
    );

    const [first, second] = await Promise.all([
      performSessionTransition({
        type: "OUT",
        origin: SESSION_ORIGIN.AUTO,
        execute,
      }),
      performSessionTransition({
        type: "OUT",
        origin: SESSION_ORIGIN.AUTO,
        execute,
      }),
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(TRANSITION_RESULT.COMPLETED);
    expect(second.status).toBe(TRANSITION_RESULT.SKIPPED);
  });

  it("does not move the state when the backend refuses", async () => {
    const outcome = await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.MANUAL,
      execute: async () => ({ allowed: false, message: "Too far away" }),
    });

    expect(outcome.status).toBe(TRANSITION_RESULT.FAILED);
    expect(outcome.response.message).toBe("Too far away");
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
  });

  it("does not move the state when the API call throws, and stays usable after", async () => {
    await expect(
      performSessionTransition({
        type: "IN",
        origin: SESSION_ORIGIN.MANUAL,
        execute: async () => {
          throw new Error("Network down");
        },
      }),
    ).rejects.toThrow("Network down");

    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);

    // The lock must not be left held by the rejection.
    const retry = await checkIn(SESSION_ORIGIN.MANUAL);
    expect(retry.status).toBe(TRANSITION_RESULT.COMPLETED);
  });

  it("rejects an unknown transition type", async () => {
    await expect(
      performSessionTransition({ type: "BOGUS", execute: ok }),
    ).rejects.toThrow(/Invalid attendance transition/);
  });

  describe("migration from pre-state-machine storage", () => {
    it("adopts an open session left by the legacy timestamp keys", async () => {
      const startedAt = Date.now() - 60 * 60 * 1000;
      await AsyncStorage.setItem(CHECKIN_START_TIME_KEY, String(startedAt));

      const session = await readSession();

      expect(session).toMatchObject({
        status: SESSION_STATUS.CHECKED_IN,
        origin: SESSION_ORIGIN.UNKNOWN,
        startedAt,
      });
    });

    it("treats a check-in older than the last check-out as closed", async () => {
      const startedAt = Date.now() - 2 * 60 * 60 * 1000;
      await AsyncStorage.multiSet([
        [CHECKIN_START_TIME_KEY, String(startedAt)],
        [LAST_CHECKOUT_TIME_KEY, String(Date.now() - 60 * 60 * 1000)],
      ]);

      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    });

    it("falls back to the legacy keys when the record is corrupt", async () => {
      await AsyncStorage.setItem(SESSION_STATE_KEY, "{not json");
      await AsyncStorage.setItem(CHECKIN_START_TIME_KEY, String(Date.now()));

      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("still lets a geofence EXIT close a migrated session of unknown origin", async () => {
      await AsyncStorage.setItem(CHECKIN_START_TIME_KEY, String(Date.now()));

      const outcome = await performSessionTransition({
        type: "OUT",
        origin: SESSION_ORIGIN.AUTO,
        execute: ok,
      });

      expect(outcome.status).toBe(TRANSITION_RESULT.COMPLETED);
    });
  });

  describe("reconcileSessionFromServer", () => {
    it("adopts a session the server reports but this device did not open", async () => {
      const activeStartedAt = Date.now() - 30 * 60 * 1000;

      const session = await reconcileSessionFromServer({ activeStartedAt });

      expect(session).toMatchObject({
        status: SESSION_STATUS.CHECKED_IN,
        origin: SESSION_ORIGIN.UNKNOWN,
        startedAt: activeStartedAt,
      });
      expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBe(
        String(activeStartedAt),
      );
    });

    it("keeps the known origin of a session already tracked locally", async () => {
      await checkIn(SESSION_ORIGIN.MANUAL);
      const activeStartedAt = Date.now() - 5 * 60 * 1000;

      const session = await reconcileSessionFromServer({ activeStartedAt });

      expect(session.origin).toBe(SESSION_ORIGIN.MANUAL);
      expect(session.startedAt).toBe(activeStartedAt);
    });

    it("closes the local session when the server reports none, without moving the check-out floor", async () => {
      await checkIn(SESSION_ORIGIN.AUTO);

      const session = await reconcileSessionFromServer({
        activeStartedAt: null,
      });

      expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
      expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(LAST_CHECKOUT_TIME_KEY)).toBeNull();
    });

    it("does not re-open a session from a status fetched before an automatic check-out", async () => {
      const { session: openSession } = await checkIn(SESSION_ORIGIN.MANUAL);

      // Status request starts here, then the geofence closes the session while
      // it is still in flight.
      await performSessionTransition({
        type: "OUT",
        origin: SESSION_ORIGIN.AUTO,
        execute: ok,
      });

      const session = await reconcileSessionFromServer({
        activeStartedAt: openSession.startedAt,
      });

      expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
      expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBeNull();
    });

    it("makes a subsequent geofence EXIT a no-op once the server says there is no session", async () => {
      await checkIn(SESSION_ORIGIN.MANUAL);
      await reconcileSessionFromServer({ activeStartedAt: null });

      const execute = jest.fn(ok);
      const outcome = await performSessionTransition({
        type: "OUT",
        origin: SESSION_ORIGIN.AUTO,
        execute,
      });

      expect(outcome.status).toBe(TRANSITION_RESULT.SKIPPED);
      expect(execute).not.toHaveBeenCalled();
    });

    // A status response cannot describe a session that opened after the request
    // went out. Without the `fetchedAt` guard the attendance screen's launch sync
    // would undo an automatic check-in that landed while it was in flight.
    describe("staleness guard", () => {
      it("does not close a session opened after the status request was issued", async () => {
        const fetchedAt = Date.now();
        // The geofence checks in while the status request is still in flight.
        const { session: opened } = await checkIn(SESSION_ORIGIN.AUTO);
        expect(opened.startedAt).toBeGreaterThan(fetchedAt - 1);

        const session = await reconcileSessionFromServer({
          activeStartedAt: null,
          fetchedAt,
        });

        expect(session.status).toBe(SESSION_STATUS.CHECKED_IN);
        expect(session.origin).toBe(SESSION_ORIGIN.AUTO);
        expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBe(
          String(opened.startedAt),
        );
      });

      it("does not backdate a newer session to an older server start", async () => {
        const fetchedAt = Date.now();
        const { session: opened } = await checkIn(SESSION_ORIGIN.AUTO);

        const session = await reconcileSessionFromServer({
          activeStartedAt: fetchedAt - 3 * 60 * 60 * 1000,
          fetchedAt,
        });

        expect(session.startedAt).toBe(opened.startedAt);
      });

      it("still closes a session that predates the status request", async () => {
        await checkIn(SESSION_ORIGIN.AUTO);
        // Request issued after the session was already open, so the response
        // genuinely speaks to it.
        const fetchedAt = Date.now() + 1000;

        const session = await reconcileSessionFromServer({
          activeStartedAt: null,
          fetchedAt,
        });

        expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
        expect(await AsyncStorage.getItem(CHECKIN_START_TIME_KEY)).toBeNull();
      });

      it("is inert when no fetchedAt is supplied", async () => {
        await checkIn(SESSION_ORIGIN.AUTO);

        const session = await reconcileSessionFromServer({
          activeStartedAt: null,
        });

        expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
      });
    });
  });

  it("clears the record for a user switch", async () => {
    await checkIn(SESSION_ORIGIN.MANUAL);
    await clearSessionState();

    expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBeNull();
  });
});

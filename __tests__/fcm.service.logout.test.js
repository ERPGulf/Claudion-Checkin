/**
 * Logout must not wait on Firebase.
 *
 * `clearFcmRegistration` is the first `await` on both logout paths — the Sign
 * out row and `expireSession`'s cleanup hook — and `clearStore()`, the thing
 * that actually swaps the navigator, runs last. So anything this function waits
 * for, the user waits for while looking at an unchanged screen.
 *
 * It used to await `deleteToken` and one `unsubscribeFromTopic` per topic, all
 * of them unbounded network round-trips. On a poor connection that was seconds;
 * offline it was longer, and it read as the app freezing on sign-out.
 */

const mockDeleteToken = jest.fn();
const mockUnsubscribeFromTopic = jest.fn();
const mockMultiRemove = jest.fn();
const mockGetItem = jest.fn();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (...args) => mockGetItem(...args),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiRemove: (...args) => mockMultiRemove(...args),
  },
}));

jest.mock("@react-native-firebase/app", () => ({
  getApp: jest.fn(() => ({ name: "[DEFAULT]" })),
  getApps: jest.fn(() => [{ name: "[DEFAULT]" }]),
}));

jest.mock("@react-native-firebase/messaging", () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  getMessaging: jest.fn(() => ({ appName: "[DEFAULT]" })),
  deleteToken: (...args) => mockDeleteToken(...args),
  unsubscribeFromTopic: (...args) => mockUnsubscribeFromTopic(...args),
  subscribeToTopic: jest.fn(() => Promise.resolve()),
  getToken: jest.fn(() => Promise.resolve("tok")),
  getAPNSToken: jest.fn(() => Promise.resolve("apns")),
  isDeviceRegisteredForRemoteMessages: jest.fn(() => true),
  registerDeviceForRemoteMessages: jest.fn(() => Promise.resolve()),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  requestPermission: jest.fn(() => Promise.resolve(1)),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  setBackgroundMessageHandler: jest.fn(),
}));

jest.mock("../services/api/apiClient", () => ({
  plainAxios: { post: jest.fn(), get: jest.fn() },
}));

jest.mock("../services/api/notification.service", () => ({
  getNotifications: jest.fn(() => Promise.resolve([])),
}));

jest.mock("../navigation/rootNavigation", () => ({
  navigateSafely: jest.fn(),
}));

/* eslint-disable import/first */
import {
  beginFcmSession,
  clearFcmRegistration,
  revokeFcmRegistration,
} from "../services/notifications/fcm.service";
/* eslint-enable import/first */

/** Resolves only when the test says so — stands in for a slow network. */
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Lets any already-scheduled microtasks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const TOPICS = ["announcements", "hr-EMP-001"];

beforeEach(() => {
  jest.clearAllMocks();
  mockMultiRemove.mockResolvedValue(undefined);
  mockDeleteToken.mockResolvedValue(undefined);
  mockUnsubscribeFromTopic.mockResolvedValue(undefined);
  mockGetItem.mockImplementation(async (key) =>
    key === "fcm_topics" ? JSON.stringify(TOPICS) : null,
  );
});

describe("clearFcmRegistration", () => {
  // The regression. If this ever starts awaiting again, sign-out goes back to
  // hanging for as long as Firebase takes.
  it("resolves without waiting for the Firebase token deletion", async () => {
    const slow = deferred();
    mockDeleteToken.mockReturnValue(slow.promise);

    // No timeout wrapper and no fake timers: if this awaited `deleteToken` the
    // promise below would simply never settle and the test would time out.
    await clearFcmRegistration();

    expect(mockDeleteToken).toHaveBeenCalledTimes(1);
    slow.resolve();
  });

  it("does not wait for the topic unsubscriptions either", async () => {
    const slow = deferred();
    mockUnsubscribeFromTopic.mockReturnValue(slow.promise);

    await clearFcmRegistration();

    slow.resolve();
  });

  // The local half still has to be finished when it returns: the app calls
  // itself logged out immediately afterwards, and a stale token left in storage
  // would be read by the next session.
  it("has already cleared local storage when it resolves", async () => {
    mockDeleteToken.mockReturnValue(deferred().promise);

    await clearFcmRegistration();

    expect(mockMultiRemove).toHaveBeenCalledWith(
      expect.arrayContaining(["fcm_token", "fcm_topics"]),
    );
  });

  it("still deregisters, just not on the caller's clock", async () => {
    await clearFcmRegistration();
    await flush();

    expect(mockDeleteToken).toHaveBeenCalledTimes(1);
    TOPICS.forEach((topic) =>
      expect(mockUnsubscribeFromTopic).toHaveBeenCalledWith(
        expect.anything(),
        topic,
      ),
    );
  });

  it("survives Firebase throwing in the background", async () => {
    mockDeleteToken.mockRejectedValue(new Error("firebase unavailable"));
    mockUnsubscribeFromTopic.mockRejectedValue(new Error("nope"));

    await expect(clearFcmRegistration()).resolves.toBeUndefined();
    await flush();
  });
});

describe("a logout still in flight when the next session starts", () => {
  /**
   * The hazard backgrounding introduces. Sign out, sign straight back in, and
   * the previous logout's `deleteToken` lands on the *new* session's token —
   * silently killing push until the next launch. The session epoch is what
   * stops it.
   */
  it("does not delete the new session's token", async () => {
    const epoch = beginFcmSession();

    // The next login claims the session while the teardown is still queued.
    beginFcmSession();

    await revokeFcmRegistration({ appName: "[DEFAULT]" }, TOPICS, epoch);

    expect(mockDeleteToken).not.toHaveBeenCalled();
    expect(mockUnsubscribeFromTopic).not.toHaveBeenCalled();
  });

  it("does deregister when no newer session has started", async () => {
    const epoch = beginFcmSession();

    await revokeFcmRegistration({ appName: "[DEFAULT]" }, TOPICS, epoch);

    expect(mockDeleteToken).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeFromTopic).toHaveBeenCalledTimes(TOPICS.length);
  });

  // A session claimed after the token was deleted but before the topics were
  // dropped must keep its subscriptions.
  it("stops between the token and the topics if a session starts mid-flight", async () => {
    const epoch = beginFcmSession();
    mockDeleteToken.mockImplementation(async () => {
      beginFcmSession();
    });

    await revokeFcmRegistration({ appName: "[DEFAULT]" }, TOPICS, epoch);

    expect(mockDeleteToken).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeFromTopic).not.toHaveBeenCalled();
  });

  it("does nothing without a messaging instance", async () => {
    await revokeFcmRegistration(null, TOPICS, beginFcmSession());

    expect(mockDeleteToken).not.toHaveBeenCalled();
  });
});

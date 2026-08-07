import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CAPABILITY_KEY,
  clearOfflineCapability,
  getOfflineCapability,
  hydrateOfflineCapability,
  isOfflineSyncUnsupported,
  markOfflineSyncSupported,
  markOfflineSyncUnsupported,
  resetOfflineCapability,
} from "../services/offline/offlineCapability";

/**
 * "Does this tenant have offline attendance?" is a different question from
 * "did this punch land?", and answering the second in place of the first is
 * what produced a permanent, unactionable banner on every employee's phone.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  resetOfflineCapability();
});

describe("before anything is known", () => {
  // Optimism is required: a first-launch outage must not disable the feature on
  // a server that supports it perfectly well.
  it("is null, not false", async () => {
    expect(await hydrateOfflineCapability()).toBeNull();
    expect(isOfflineSyncUnsupported()).toBe(false);
  });
});

describe("learning from sync outcomes", () => {
  it("records that the server has no offline endpoint", async () => {
    await markOfflineSyncUnsupported();

    expect(isOfflineSyncUnsupported()).toBe(true);
    expect(await AsyncStorage.getItem(CAPABILITY_KEY)).toBe("false");
  });

  // Self-healing: nobody tells the app the endpoint was deployed. A blocked row
  // is retried at launch, the server takes it, and the feature comes back.
  it("turns back on the moment the server accepts anything", async () => {
    await markOfflineSyncUnsupported();
    await markOfflineSyncSupported();

    expect(isOfflineSyncUnsupported()).toBe(false);
    expect(getOfflineCapability()).toBe(true);
  });

  it("survives a restart", async () => {
    await markOfflineSyncUnsupported();
    resetOfflineCapability();

    expect(await hydrateOfflineCapability()).toBe(false);
  });

  it("notifies listeners on a real change only", async () => {
    const listener = jest.fn();
    const { addCapabilityListener } = require("../services/offline/offlineCapability");
    addCapabilityListener(listener);

    await markOfflineSyncUnsupported();
    await markOfflineSyncUnsupported(); // same value — no second notification

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("logout", () => {
  // The next login may be a different tenant. Carrying "unsupported" across
  // would disable offline attendance on a server that supports it.
  it("forgets what it learned", async () => {
    await markOfflineSyncUnsupported();
    await clearOfflineCapability();

    expect(getOfflineCapability()).toBeNull();
    expect(await AsyncStorage.getItem(CAPABILITY_KEY)).toBeNull();
  });
});

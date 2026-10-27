/**
 * A rehydrate that fails restores the initial, signed-out state, and
 * redux-persist then writes it over the stored session. Two ways that used to
 * happen without the employee doing anything: a read slower than
 * redux-persist's 5 s default timeout, and iOS refusing reads while a
 * background (geofence) launch runs before the phone's first unlock.
 */
const SIGNED_IN = JSON.stringify({
  userAuth: JSON.stringify({ isLoggedIn: true, token: null }),
  _persist: JSON.stringify({ version: -1, rehydrated: true }),
});

/** A fresh Store module, after `arrange` has set up its storage and AppState. */
const loadStore = (arrange) => {
  let store;
  jest.isolateModules(() => {
    arrange({
      AsyncStorage: require("@react-native-async-storage/async-storage"),
      AppState: require("react-native").AppState,
    });
    ({ store } = require("../redux/Store"));
  });
  return store;
};
const rehydrated = (store) => store.getState()._persist.rehydrated;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("waits out a slow read instead of restoring the signed-out state", async () => {
  const store = loadStore(({ AsyncStorage, AppState }) => {
    AppState.currentState = "active";
    AsyncStorage.getItem.mockImplementationOnce(() =>
      new Promise((resolve) => setTimeout(() => resolve(SIGNED_IN), 6000)));
  });

  await jest.advanceTimersByTimeAsync(6000);

  expect(rehydrated(store)).toBe(true);
  expect(store.getState().userAuth.isLoggedIn).toBe(true);
});

it("retries reads refused during a background launch until storage opens", async () => {
  const store = loadStore(({ AsyncStorage, AppState }) => {
    AppState.currentState = "background";
    AsyncStorage.getItem
      .mockRejectedValueOnce(new Error("Failed to read storage file."))
      .mockRejectedValueOnce(new Error("Failed to read storage file."))
      .mockResolvedValueOnce(SIGNED_IN);
  });

  await jest.advanceTimersByTimeAsync(1500);
  expect(rehydrated(store)).toBe(false);

  await jest.advanceTimersByTimeAsync(1000);
  expect(rehydrated(store)).toBe(true);
  expect(store.getState().userAuth.isLoggedIn).toBe(true);
});

it("still reports a refused read in the foreground", async () => {
  const store = loadStore(({ AsyncStorage, AppState }) => {
    AppState.currentState = "active";
    AsyncStorage.getItem.mockRejectedValueOnce(new Error("Failed to read storage file."));
  });

  await jest.advanceTimersByTimeAsync(0);

  expect(rehydrated(store)).toBe(true);
  expect(store.getState().userAuth.isLoggedIn).toBe(false);
});

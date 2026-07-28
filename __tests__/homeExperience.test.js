const KEY = 'experimental_new_home_experience';

/**
 * The store keeps its value at module scope, so every case needs a fresh copy.
 *
 * `jest.isolateModules` gives the isolated registry its own instance of the
 * AsyncStorage mock, so the storage handle is pulled from inside that same
 * registry — asserting against the outer import would target a different
 * in-memory store than the one the module under test actually writes to.
 */
function loadStore() {
  let store;
  let storage;
  jest.isolateModules(() => {
    storage = require('@react-native-async-storage/async-storage');
    storage = storage.default ?? storage;
    store = require('../settings/homeExperience');
  });
  return { store, storage };
}

describe('homeExperience store', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to the new Home when nothing is stored', async () => {
    const { store } = loadStore();
    expect(store.getSnapshot()).toBe(true);
    expect(store.getHydratedSnapshot()).toBe(false);

    await store.hydrate();

    expect(store.getSnapshot()).toBe(true);
    expect(store.getHydratedSnapshot()).toBe(true);
  });

  it('restores a stored opt-out on launch', async () => {
    const { store, storage } = loadStore();
    await storage.setItem(KEY, 'false');

    await store.hydrate();

    expect(store.getSnapshot()).toBe(false);
  });

  it('restores a stored opt-in on launch', async () => {
    const { store, storage } = loadStore();
    await storage.setItem(KEY, 'true');

    await store.hydrate();

    expect(store.getSnapshot()).toBe(true);
  });

  it('falls back to the default for an unrecognised stored value', async () => {
    const { store, storage } = loadStore();
    await storage.setItem(KEY, 'garbage');

    await store.hydrate();

    expect(store.getSnapshot()).toBe(true);
    expect(store.getHydratedSnapshot()).toBe(true);
  });

  it('falls back to the default when the key reads back as undefined', async () => {
    // The AsyncStorage mock — and some platform versions — resolve a missing
    // key to `undefined` rather than `null`.
    const { store, storage } = loadStore();
    jest.spyOn(storage, 'getItem').mockResolvedValueOnce(undefined);

    await store.hydrate();

    expect(store.getSnapshot()).toBe(true);
  });

  it('keeps the default and still hydrates when storage throws', async () => {
    const { store, storage } = loadStore();
    jest
      .spyOn(storage, 'getItem')
      .mockRejectedValueOnce(new Error('disk full'));

    await store.hydrate();

    expect(store.getSnapshot()).toBe(true);
    expect(store.getHydratedSnapshot()).toBe(true);
  });

  it('notifies subscribers before the write settles, so the UI is immediate', async () => {
    const { store } = loadStore();
    await store.hydrate();

    const listener = jest.fn();
    store.subscribe(listener);

    const pending = store.setEnabled(false);

    // Emitted synchronously — no await between the tap and the re-render.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(false);

    await pending;
  });

  it('persists the choice so the next launch can restore it', async () => {
    const { store, storage } = loadStore();
    await store.hydrate();

    await store.setEnabled(false);

    await expect(storage.getItem(KEY)).resolves.toBe('false');
  });

  it('keeps the in-memory value when persisting fails', async () => {
    const { store, storage } = loadStore();
    await store.hydrate();
    jest
      .spyOn(storage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));

    await store.setEnabled(false);

    expect(store.getSnapshot()).toBe(false);
  });

  it('ignores a set to the current value', async () => {
    const { store, storage } = loadStore();
    await store.hydrate();
    const listener = jest.fn();
    store.subscribe(listener);
    const setItem = jest.spyOn(storage, 'setItem');

    await store.setEnabled(true);

    expect(listener).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const { store } = loadStore();
    await store.hydrate();
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    await store.setEnabled(false);

    expect(listener).not.toHaveBeenCalled();
  });
});

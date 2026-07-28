const KEY = 'settings_appearance_mode';

/**
 * The store keeps its value at module scope, so every case needs a fresh copy.
 * The storage handle is pulled from inside the isolated registry — see the note
 * in homeExperience.test.js.
 */
function loadStore() {
  let store;
  let storage;
  jest.isolateModules(() => {
    storage = require('@react-native-async-storage/async-storage');
    storage = storage.default ?? storage;
    store = require('../settings/appearance');
  });
  return { store, storage };
}

describe('appearance store', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('follows the system by default', async () => {
    const { store } = loadStore();
    expect(store.getSnapshot()).toBe('system');
    expect(store.getHydratedSnapshot()).toBe(false);

    await store.hydrate();

    expect(store.getSnapshot()).toBe('system');
    expect(store.getHydratedSnapshot()).toBe(true);
  });

  it.each(['light', 'dark', 'system'])('restores a stored %s mode', async m => {
    const { store, storage } = loadStore();
    await storage.setItem(KEY, m);

    await store.hydrate();

    expect(store.getSnapshot()).toBe(m);
  });

  it('falls back to the default for an unrecognised stored mode', async () => {
    const { store, storage } = loadStore();
    await storage.setItem(KEY, 'sepia');

    await store.hydrate();

    expect(store.getSnapshot()).toBe('system');
  });

  it('falls back to the default when the key reads back as undefined', async () => {
    const { store, storage } = loadStore();
    jest.spyOn(storage, 'getItem').mockResolvedValueOnce(undefined);

    await store.hydrate();

    expect(store.getSnapshot()).toBe('system');
  });

  it('keeps the default and still hydrates when storage throws', async () => {
    const { store, storage } = loadStore();
    jest
      .spyOn(storage, 'getItem')
      .mockRejectedValueOnce(new Error('disk full'));

    await store.hydrate();

    expect(store.getSnapshot()).toBe('system');
    expect(store.getHydratedSnapshot()).toBe(true);
  });

  it('notifies subscribers before the write settles', async () => {
    const { store } = loadStore();
    await store.hydrate();
    const listener = jest.fn();
    store.subscribe(listener);

    const pending = store.setMode('dark');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe('dark');

    await pending;
  });

  it('persists the choice so the next launch can restore it', async () => {
    const { store, storage } = loadStore();
    await store.hydrate();

    await store.setMode('light');

    await expect(storage.getItem(KEY)).resolves.toBe('light');
  });

  it('rejects an unknown mode without touching state', async () => {
    const { store, storage } = loadStore();
    await store.hydrate();
    const listener = jest.fn();
    store.subscribe(listener);
    const setItem = jest.spyOn(storage, 'setItem');

    await store.setMode('sepia');

    expect(store.getSnapshot()).toBe('system');
    expect(listener).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('ignores a set to the current mode', async () => {
    const { store } = loadStore();
    await store.hydrate();
    const listener = jest.fn();
    store.subscribe(listener);

    await store.setMode('system');

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const { store } = loadStore();
    await store.hydrate();
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    await store.setMode('dark');

    expect(listener).not.toHaveBeenCalled();
  });
});

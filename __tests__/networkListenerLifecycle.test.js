import NetInfo from "@react-native-community/netinfo";
import {
  addNetworkChangeListener,
  addReconnectListener,
  fetchShouldAttemptRequest,
  getNetworkState,
  isOnline,
  resetNetworkListener,
  startNetworkListener,
  stopNetworkListener,
} from "../services/offline/NetworkListener";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  resetNetworkListener();
  NetInfo.fetch.mockResolvedValue({ type: "wifi", isConnected: true });
  NetInfo.addEventListener.mockClear();
});

afterEach(() => resetNetworkListener());

it.each([null, undefined])("attempts a request when a fresh NetInfo read has unknown connectivity (%s)", async isConnected => {
  NetInfo.fetch.mockResolvedValue({ type: "unknown", isConnected, isInternetReachable: false });
  expect(await fetchShouldAttemptRequest()).toBe(true);
  expect(getNetworkState().isConnected).toBeNull();
});

it("keeps native unknown connectivity distinct from a confirmed disconnected interface", async () => {
  startNetworkListener();
  await flush();
  const onNetwork = NetInfo.addEventListener.mock.calls.at(-1)[0];
  onNetwork({ type: "wifi", isConnected: null, isInternetReachable: false });
  expect(isOnline()).toBe(true);
  onNetwork({ type: "wifi", isConnected: false });
  expect(isOnline()).toBe(false);
  onNetwork({ type: "none", isConnected: null });
  expect(isOnline()).toBe(false);
});

it("does not let an older fetch replace a newer native connectivity event", async () => {
  const pending = deferred();
  NetInfo.fetch.mockReturnValueOnce(pending.promise);
  startNetworkListener();
  const onNetwork = NetInfo.addEventListener.mock.calls.at(-1)[0];
  onNetwork({ type: "none", isConnected: false });
  pending.resolve({ type: "wifi", isConnected: true });
  await flush();
  expect(getNetworkState()).toMatchObject({ type: "none", isConnected: false });
  expect(isOnline()).toBe(false);
});

it("ignores pending fetches and retained native callbacks after teardown", async () => {
  const pending = deferred();
  const changed = jest.fn();
  const reconnected = jest.fn();
  addNetworkChangeListener(changed);
  addReconnectListener(reconnected);
  NetInfo.fetch.mockReturnValueOnce(pending.promise);
  startNetworkListener();
  const onNetwork = NetInfo.addEventListener.mock.calls.at(-1)[0];
  onNetwork({ type: "none", isConnected: false });
  changed.mockClear();
  stopNetworkListener();
  onNetwork({ type: "wifi", isConnected: true });
  pending.resolve({ type: "cellular", isConnected: true });
  await flush();
  expect(getNetworkState()).toMatchObject({ type: "none", isConnected: false });
  expect(changed).not.toHaveBeenCalled();
  expect(reconnected).not.toHaveBeenCalled();
});

it("ignores a previous subscription's callback after a restart", async () => {
  startNetworkListener();
  await flush();
  const previous = NetInfo.addEventListener.mock.calls.at(-1)[0];
  stopNetworkListener();
  startNetworkListener();
  await flush();
  const current = NetInfo.addEventListener.mock.calls.at(-1)[0];
  current({ type: "none", isConnected: false });
  previous({ type: "wifi", isConnected: true });
  expect(isOnline()).toBe(false);
});

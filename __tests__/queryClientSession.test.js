import { isCancelledError } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryClient } from "../services/queryClient";
import { saveTokens } from "../services/api/apiClient";
import {
  activateAuthSession,
  addAuthSessionInvalidationListener,
  getAuthSessionGeneration,
  invalidateAuthSession,
  isAuthSessionSuspended,
} from "../utils/authSessionGuard";

jest.mock("../redux/Store", () => ({
  store: { dispatch: jest.fn(), getState: () => ({}) },
}));

const key = ["expenseClaims", "EMP-SYNTHETIC"];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  queryClient.clear();
  activateAuthSession(getAuthSessionGeneration());
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

it("removes cached HR records synchronously before a same-code tenant signs in", async () => {
  queryClient.setQueryData(key, [{ name: "tenant-alpha-claim" }]);
  queryClient.setQueryData(["attendanceHistory", "EMP-SYNTHETIC"], {
    pages: [[{ name: "tenant-alpha-punch" }]], pageParams: [0],
  });
  queryClient.getMutationCache().build(queryClient, {
    mutationKey: ["tenant-alpha-mutation"], mutationFn: async () => "completed", gcTime: 0,
  });

  const generation = invalidateAuthSession();

  // No effect or asynchronous cleanup needs to run before stale data is gone.
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  expect(queryClient.getQueryData(key)).toBeUndefined();

  activateAuthSession(generation);
  await queryClient.fetchQuery({
    queryKey: key, queryFn: async () => [{ name: "tenant-beta-claim" }],
  });
  expect(queryClient.getQueryData(key)).toEqual([{ name: "tenant-beta-claim" }]);
});

it("cannot resurrect the previous tenant's delayed response into a reused query key", async () => {
  const alpha = deferred();
  const oldRequest = queryClient.fetchQuery({ queryKey: key, queryFn: () => alpha.promise });
  // Observe cancellation before invalidation so rejection cannot go unhandled.
  const cancelled = oldRequest.catch((error) => error);

  activateAuthSession(invalidateAuthSession());
  await queryClient.fetchQuery({
    queryKey: key, queryFn: async () => [{ name: "tenant-beta-claim" }],
  });
  alpha.resolve([{ name: "tenant-alpha-late-claim" }]);
  await Promise.resolve();

  expect(isCancelledError(await cancelled)).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual([{ name: "tenant-beta-claim" }]);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
});

it("aborts query transport when supported and stops old retry requests under the new session", async () => {
  jest.useFakeTimers();
  let signal;
  const queryFn = jest.fn(({ signal: requestSignal }) => {
    signal = requestSignal;
    return Promise.reject(new Error("synthetic transport outage"));
  });
  const oldRequest = queryClient.fetchQuery({
    queryKey: key, queryFn, retry: 3, retryDelay: 1000,
  });
  const cancelled = oldRequest.catch((error) => error);
  await jest.advanceTimersByTimeAsync(0);
  expect(queryFn).toHaveBeenCalledTimes(1);

  activateAuthSession(invalidateAuthSession());
  expect(signal.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(10000);

  expect(isCancelledError(await cancelled)).toBe(true);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(key)).toBeUndefined();
});

it("keeps cached records when rotated tokens activate the current generation", async () => {
  const generation = getAuthSessionGeneration();
  queryClient.setQueryData(key, [{ name: "current-session-claim" }]);

  await saveTokens("synthetic-rotated-access", "synthetic-rotated-refresh", generation);

  expect(getAuthSessionGeneration()).toBe(generation);
  expect(isAuthSessionSuspended()).toBe(false);
  expect(await AsyncStorage.getItem("access_token")).toBe("synthetic-rotated-access");
  expect(queryClient.getQueryData(key)).toEqual([{ name: "current-session-claim" }]);
});

it("notifies cleanup synchronously after invalidation and supports unsubscribe", () => {
  const observer = jest.fn((generation) => {
    expect(generation).toBe(getAuthSessionGeneration());
    expect(isAuthSessionSuspended()).toBe(true);
  });
  const unsubscribe = addAuthSessionInvalidationListener(observer);
  invalidateAuthSession();
  expect(observer).toHaveBeenCalledTimes(1);

  unsubscribe();
  invalidateAuthSession();
  expect(observer).toHaveBeenCalledTimes(1);
});

it("does not let synchronous or asynchronous cleanup failures stop other listeners", async () => {
  const cleanup = jest.fn();
  const unsubscribeSync = addAuthSessionInvalidationListener(() => { throw new Error("synthetic cleanup failure"); });
  const unsubscribeAsync = addAuthSessionInvalidationListener(() => Promise.reject(new Error("synthetic async cleanup failure")));
  const unsubscribeCleanup = addAuthSessionInvalidationListener(cleanup);
  try {
    const before = getAuthSessionGeneration();
    expect(invalidateAuthSession()).toBe(before + 1);
    expect(cleanup).toHaveBeenCalledWith(before + 1);
    expect(isAuthSessionSuspended()).toBe(true);
    await Promise.resolve();
  } finally {
    unsubscribeSync();
    unsubscribeAsync();
    unsubscribeCleanup();
  }
});

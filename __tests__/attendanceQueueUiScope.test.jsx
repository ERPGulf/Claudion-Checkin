import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

let mockState;
jest.mock("react-redux", () => ({ useSelector: selector => selector(mockState) }));
jest.mock("@tanstack/react-query", () => ({ useInfiniteQuery: () => ({
  data: { pages: [[]] }, refetch: jest.fn(), fetchNextPage: jest.fn(),
}) }));
jest.mock("../services/api", () => ({ getUserAttendance: jest.fn() }));
jest.mock("../services/offline/AttendanceQueueService", () => ({
  addQueueChangeListener: jest.fn(() => () => {}),
  getHistoryRows: jest.fn(), getQueueCounts: jest.fn(), getUnresolvedRows: jest.fn(),
}));
jest.mock("../services/offline/BackgroundSyncManager", () => ({ syncNow: jest.fn() }));
jest.mock("../services/offline/AttendanceSyncService", () => ({
  addSyncListener: jest.fn(() => () => {}), isSyncing: () => false, SYNC_PHASE: { START: "start" },
}));
jest.mock("../services/offline/NetworkListener", () => ({
  addNetworkChangeListener: jest.fn(() => () => {}), fetchIsOnline: async () => true, isOnline: () => true,
}));
jest.mock("../services/offline/offlineCapability", () => ({
  addCapabilityListener: jest.fn(() => () => {}), getOfflineCapability: () => true,
  hydrateOfflineCapability: async () => true,
}));
jest.mock("../hooks/useOfflineSyncAlerts", () => () => ({ enabled: true }));

import useAttendanceHistory from "../hooks/useAttendanceHistory";
import useOfflineStatus from "../hooks/useOfflineStatus";
import { getHistoryRows, getQueueCounts, getUnresolvedRows } from "../services/offline/AttendanceQueueService";
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from "../utils/authSessionGuard";

const tenantA = "https://company-a.example";
const tenantB = "https://company-b.example";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const selectCompany = async tenantKey => {
  mockState = { userAuth: { isLoggedIn: true }, user: { baseUrl: tenantKey,
    userDetails: { employeeCode: "0007" } } };
  await AsyncStorage.multiSet([["baseUrl", tenantKey], ["employee_code", "0007"],
    ["access_token", "synthetic-access"], ["api_key", "synthetic-account"]]);
};

beforeEach(async () => {
  jest.clearAllMocks();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await selectCompany(tenantA);
  getHistoryRows.mockResolvedValue([]);
  getQueueCounts.mockResolvedValue({ pendingCount: 0 });
  getUnresolvedRows.mockResolvedValue([]);
});

it("uses a captured tenant owner for history and queue counts", async () => {
  const { result } = renderHook(() => useAttendanceHistory());
  await waitFor(() => expect(getHistoryRows).toHaveBeenCalledWith("0007", expect.objectContaining({ tenantKey: tenantA })));
  expect(getQueueCounts).toHaveBeenCalledWith("0007", expect.objectContaining({ tenantKey: tenantA }));
  expect(result.current.records).toEqual([]);
});

it("does not publish a previous tenant's late history rows after a same-code account switch", async () => {
  const pending = deferred();
  getHistoryRows.mockReturnValueOnce(pending.promise);
  getQueueCounts.mockResolvedValueOnce({ pendingCount: 7 });
  const { result, rerender } = renderHook(() => useAttendanceHistory());
  await waitFor(() => expect(getHistoryRows).toHaveBeenCalledTimes(1));
  await act(async () => {
    invalidateAuthSession();
    activateAuthSession(getAuthSessionGeneration());
    await selectCompany(tenantB);
    rerender({});
  });
  await waitFor(() => expect(getHistoryRows).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve([{ id: 1, timestamp: "2026-11-04 09:00:00", action: "checkin", status: "pending" }]));
  expect(result.current.records).toEqual([]);
  expect(result.current.pendingCount).toBe(0);
});

it("does not publish previous-tenant banner counts after a same-code account switch", async () => {
  const pending = deferred();
  getQueueCounts.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(() => useOfflineStatus());
  await waitFor(() => expect(getQueueCounts).toHaveBeenCalledTimes(1));
  await act(async () => {
    invalidateAuthSession();
    activateAuthSession(getAuthSessionGeneration());
    await selectCompany(tenantB);
    rerender({});
  });
  await waitFor(() => expect(getQueueCounts).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve({ pendingCount: 7, unresolvedCount: 7 }));
  expect(result.current.pendingCount).toBe(0);
  expect(result.current.unresolvedCount).toBe(0);
});

it("refuses a sheet's late old-owner rows after authentication changes", async () => {
  const pending = deferred();
  getUnresolvedRows.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useOfflineStatus());
  let rows;
  await act(async () => { rows = result.current.loadUnresolvedRows(); });
  await waitFor(() => expect(getUnresolvedRows).toHaveBeenCalledWith("0007", expect.objectContaining({ tenantKey: tenantA })));
  await act(async () => {
    invalidateAuthSession();
    activateAuthSession(getAuthSessionGeneration());
    pending.resolve([{ id: 1, tenantKey: tenantA }]);
  });
  expect(await rows).toEqual([]);
});

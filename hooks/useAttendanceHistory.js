import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useInfiniteQuery } from '@tanstack/react-query';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { getUserAttendance } from '../services/api';
import {
  groupRecordsByDay,
  mergeQueuedRecords,
} from '../utils/attendanceHistory';
import {
  addQueueChangeListener,
  getHistoryRows,
  getQueueCounts,
} from '../services/offline/AttendanceQueueService';
import { syncNow } from '../services/offline/BackgroundSyncManager';

/** Server page size. Also the pagination cursor step — kept in one place. */
export const PAGE_SIZE = 20;

/**
 * Every bit of attendance-history data logic, shared by the classic and modern
 * screens so neither can drift from the other.
 *
 * The query, the page-size arithmetic and the `loadMore` guard are lifted
 * verbatim from the original screen — same queryKey, same cursor, same error
 * handling. `refetch`/`isRefetching` are additions used only by the modern
 * screen's pull-to-refresh; the classic screen ignores them, so its behaviour is
 * unchanged.
 *
 * Locally queued punches are folded into the same list rather than shown
 * separately (see `mergeQueuedRecords`), so the screen renders one timeline
 * whether or not the device has been online. The queue is read from SQLite, not
 * React Query — it changes from geofence listeners and the background drain,
 * neither of which is a query — so it is subscribed to instead, and the merge
 * re-runs when it changes.
 */
export default function useAttendanceHistory() {
  const employeeCode = useSelector(selectEmployeeCode);
  const [queueRows, setQueueRows] = useState([]);
  const [queueCounts, setQueueCounts] = useState(null);

  const {
    isLoading,
    isError,
    error,
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['attendanceHistory', employeeCode],
    queryFn: async ({ pageParam = 0 }) => {
      const result = await getUserAttendance(employeeCode, pageParam, PAGE_SIZE);
      if (result.error) throw new Error(result.error);
      return result;
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
  });

  const reloadQueue = useCallback(async () => {
    if (!employeeCode) {
      setQueueRows([]);
      setQueueCounts(null);
      return;
    }

    try {
      const [rows, counts] = await Promise.all([
        getHistoryRows(employeeCode),
        getQueueCounts(employeeCode),
      ]);

      setQueueRows(rows);
      setQueueCounts(counts);
    } catch (queueError) {
      // A queue read failing must never blank the server history.
      console.log('[useAttendanceHistory] Queue read failed:', queueError?.message);
    }
  }, [employeeCode]);

  useEffect(() => {
    reloadQueue();
    return addQueueChangeListener(reloadQueue);
  }, [reloadQueue]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const serverRecords = useMemo(
    () => data?.pages?.flatMap(page => page) ?? [],
    [data],
  );

  const records = useMemo(
    () => mergeQueuedRecords(serverRecords, queueRows),
    [serverRecords, queueRows],
  );

  // Grouping is derived, never persisted — the flat list stays the source of
  // truth so pagination keeps appending to it untouched.
  const sections = useMemo(() => groupRecordsByDay(records), [records]);

  /**
   * Pull-to-refresh does both halves: drains the queue, then refetches. In that
   * order, so a punch that syncs during the pull is already on the server by the
   * time the query runs and the row resolves to its server copy in one pass
   * rather than two.
   */
  const refreshAll = useCallback(async () => {
    try {
      await syncNow({ trigger: 'history-pull-to-refresh' });
    } catch (syncError) {
      console.log('[useAttendanceHistory] Sync failed:', syncError?.message);
    }
    await reloadQueue();
    return refetch();
  }, [refetch, reloadQueue]);

  return {
    employeeCode,
    isLoading,
    isError,
    error,
    data,
    records,
    sections,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
    loadMore,
    refetch,
    // Offline additions. Existing callers ignore them, so both screens are
    // unchanged until they opt in.
    refreshAll,
    reloadQueue,
    queueCounts,
    pendingCount: queueCounts?.pendingCount ?? 0,
    blockedCount: queueCounts?.blockedCount ?? 0,
    rejectedCount: queueCounts?.rejectedCount ?? 0,
    // Everything without an outcome — the history badge wants the full picture,
    // unlike the attendance screen's guard, which deliberately excludes rejected.
    unresolvedCount: queueCounts?.unresolvedCount ?? 0,
  };
}

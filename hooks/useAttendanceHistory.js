import { useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useInfiniteQuery } from '@tanstack/react-query';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { getUserAttendance } from '../services/api';
import { groupRecordsByDay } from '../utils/attendanceHistory';

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
 */
export default function useAttendanceHistory() {
  const employeeCode = useSelector(selectEmployeeCode);

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

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const records = useMemo(
    () => data?.pages?.flatMap(page => page) ?? [],
    [data],
  );

  // Grouping is derived, never persisted — the flat list stays the source of
  // truth so pagination keeps appending to it untouched.
  const sections = useMemo(() => groupRecordsByDay(records), [records]);

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
  };
}

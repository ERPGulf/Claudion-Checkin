import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';

/** Records revealed per "Load more" press. Matches Expense Claims. */
export const PAGE_SIZE = 5;

/**
 * The "list what I've submitted" half of Loan Application, Leave Request and
 * Attendance Request.
 *
 * All three list endpoints under `employee_app.employee_list` answer the same
 * shape — `{ message: [...] }` on success, `{ error }` on failure — return the
 * whole history in one response, and are read the same way: newest first, five
 * at a time behind a "Load more". That was three copies of the same twenty
 * lines, so it is one hook parameterised by which endpoint and which date field
 * to sort on.
 *
 * `enabled` on the employee code, like every other history in the app: the
 * endpoints resolve the employee from the session, so firing before Redux has
 * rehydrated would ask the server whose records it means.
 *
 * The service layer already turns a transport failure into `{ error }`; this
 * rethrows it so react-query sees a rejected query and the screen can offer a
 * retry, rather than rendering an empty list over a failure.
 */
export default function useRequestHistory({ queryKey, fetcher, sortBy }) {
  const employeeCode = useSelector(selectEmployeeCode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const {
    data: items = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [queryKey, employeeCode],
    queryFn: async () => {
      const res = await fetcher();

      if (res?.error) {
        throw new Error(res.error);
      }

      // `slice()` first — the array is the query cache's, and sorting in place
      // would mutate cached data.
      return (res?.message || [])
        .slice()
        .sort((a, b) => new Date(b?.[sortBy]) - new Date(a?.[sortBy]));
    },
    enabled: !!employeeCode,
  });

  const showMore = useCallback(
    () => setVisibleCount(prev => prev + PAGE_SIZE),
    [],
  );

  /** Back to the first page — called after a submission adds a new record. */
  const resetPagination = useCallback(() => setVisibleCount(PAGE_SIZE), []);

  return {
    items,
    visible: items.slice(0, visibleCount),
    hasMore: visibleCount < items.length,
    showMore,
    resetPagination,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  };
}

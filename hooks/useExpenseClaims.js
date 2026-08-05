import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useSelector } from 'react-redux';
import { useMutation, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import {
  createExpenseClaim,
  getExpenseClaims,
  uploadExpenseAttachment,
} from '../services/api';

/** Claims revealed per "Load more" press. Unchanged from the classic screen. */
export const PAGE_SIZE = 5;

/**
 * The screen-level half of Expense Claims: the history query, the create
 * mutation with its follow-up attachment upload, and the client-side "load
 * more" cursor.
 *
 * Shared by the classic and modern screens so neither can drift from the other.
 * The query key, the sort, the `enabled` guard, the mutation's success path
 * (upload → refetch → Alert → reset the form) and every Alert string are lifted
 * verbatim from the original screen. The only thing dropped in the move is four
 * `console.log` debug lines that printed the raw create response and the picked
 * file; nothing observable changed.
 *
 * The form's own state lives in useExpenseClaimForm — the two are separate
 * because the classic UI puts the form in a child component and the modern UI
 * inlines it, and neither arrangement should force the other to re-render.
 */
export default function useExpenseClaims() {
  const employeeCode = useSelector(selectEmployeeCode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [resetFormFlag, setResetFormFlag] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');

  // The app is multi-tenant, so an attachment path from the server is only
  // resolvable against the URL this device was provisioned with. Read once here
  // rather than per card, which is what the classic <ExpenseCard> did.
  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem('baseUrl').then(stored => {
      if (!cancelled) setBaseUrl(stored || '');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const {
    data: claims = [],
    isLoading: isFetching,
    isError,
    error,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['expenseClaims', employeeCode],
    queryFn: async () => {
      const res = await getExpenseClaims();

      if (res?.error) {
        throw new Error(res.error);
      }

      return (res?.message || []).sort(
        (a, b) => new Date(b.expense_date) - new Date(a.expense_date),
      );
    },
    enabled: !!employeeCode,
  });

  const { mutate: addClaim, isPending: isCreating } = useMutation({
    mutationFn: createExpenseClaim,
    onSuccess: async (res, variables) => {
      const docname = res?.id;

      try {
        if (variables.file_url && docname) {
          await uploadExpenseAttachment(variables.file_url, docname);
        }
      } catch (e) {
        Alert.alert('Warning', 'Expense created, but file upload failed.');
      }

      await refetch();

      Alert.alert('Success', 'Expense claim submitted successfully!', [
        {
          text: 'OK',
          onPress: () => {
            setResetFormFlag(prev => !prev);
          },
        },
      ]);
    },
    onError: err => {
      Alert.alert('Error', err.message || 'Failed to create expense claim.');
    },
  });

  /* ---------------------------------------------------------------------
   * Pagination
   *
   * The reveal itself is unchanged: one page is PAGE_SIZE more rows off the
   * array the query already holds. What is new is that `loadMore` can now be
   * called by a scroll position rather than only by a button press, and a
   * scroll fires it repeatedly — `onEndReached` can come in several times
   * before React has committed the last increment.
   *
   * `pending` blocks everything after the first call until `visibleCount`
   * actually changes, so a burst of end-of-list events advances exactly one
   * page. The classic screen's button is unaffected: one press was always one
   * page, and still is.
   * ------------------------------------------------------------------- */

  const total = claims.length;
  const hasMore = visibleCount < total;
  const pending = useRef(false);

  useEffect(() => {
    pending.current = false;
  }, [visibleCount]);

  const loadMore = useCallback(() => {
    if (pending.current || visibleCount >= total) return;
    pending.current = true;
    setVisibleCount(prev => prev + PAGE_SIZE);
  }, [visibleCount, total]);

  /**
   * Pull-to-refresh: back to the first page, then refetch.
   *
   * The cursor is reset *before* the request so the list can't briefly show
   * page four of a set that no longer has one. Only the modern screen calls
   * this — the classic screen has no pull gesture, and the mutation's own
   * post-submit `refetch()` deliberately keeps the cursor where it was.
   */
  const refresh = useCallback(() => {
    setVisibleCount(PAGE_SIZE);
    return refetch();
  }, [refetch]);

  const visibleClaims = claims.slice(0, visibleCount);

  return {
    employeeCode,
    baseUrl,

    // History
    claims,
    visibleClaims,
    isFetching,
    // Surfaced for the modern screen, which tells "couldn't load" apart from
    // "nothing yet". The classic screen never read these and still renders its
    // "No expense claims yet." line for both, exactly as it always did.
    isError,
    error,
    refetch,
    isRefetching,
    refresh,

    // Pagination — same client-side slice the classic screen used
    visibleCount,
    hasMore,
    loadMore,

    // Create
    addClaim,
    isCreating,
    resetFormFlag,
  };
}

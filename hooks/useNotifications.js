import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import {
  getNotifications,
  markNotificationAsRead,
} from '../services/api/notification.service';
import { decrementUnreadCount } from '../redux/Slices/notificationSlice';
import {
  countUnread,
  filterNotifications,
  groupByDate,
} from '../utils/notifications';

/**
 * Everything the notification centre does, lifted out of the classic screen so
 * the modern UI is presentation only.
 *
 * Unchanged from `screens/NotificationsLegacy.jsx`:
 *
 * - The load is the same single `getNotifications(employeeId)` call with the
 *   employee id read from AsyncStorage, and it still bails out when there is no
 *   id. There is no cursor and no page size — the endpoint returns the whole
 *   list — which is also why the search below can be client-side.
 * - Opening a notification does the same four things in the same order:
 *   `decrementUnreadCount()` only when it was unread, select it, mark it read in
 *   local state optimistically, then `markNotificationAsRead(name)` with its
 *   failure swallowed. The bell badge and the server both end up where they were.
 * - Grouping is `utils/notifications.js#groupByDate`, the classic reduce over the
 *   classic `formatDateLabel`.
 *
 * Additions, all presentation-only and none of them touching the API:
 *
 * - `loading`, so the screen can show a skeleton. The classic screen had no
 *   loading state at all: `list.length === 0` rendered "No notifications" while
 *   the request was still in flight, so an empty screen and a loading screen
 *   looked identical.
 * - `searchQuery` / `filtered`, a local filter over the list already in memory.
 * - `refresh`, which re-runs the same load — the list was fetched once on mount
 *   and had no way to update without leaving the screen.
 * - `unreadCount`, counted with the same `read === 0` rule for the header line.
 */
export default function useNotifications() {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const dispatch = useDispatch();

  const load = useCallback(async () => {
    const employeeId = await AsyncStorage.getItem('employee_id');
    if (!employeeId) return;

    const res = await getNotifications(employeeId);
    setList(res);
  }, []);

  useEffect(() => {
    let active = true;

    const initialLoad = async () => {
      try {
        await load();
      } finally {
        // Guards a late resolve after the screen is gone — the classic screen
        // set state unconditionally and warned on unmount.
        if (active) setLoading(false);
      }
    };

    initialLoad();

    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /* ---------------------------------------------------------------------
   * Open / close
   * ------------------------------------------------------------------- */

  const openNotification = useCallback(
    async notification => {
      // Only decrement if it was unread.
      if (notification.read === 0) {
        dispatch(decrementUnreadCount());
      }

      setSelected(notification);

      setList(prev =>
        prev.map(n =>
          n.name === notification.name ? { ...n, read: 1 } : n,
        ),
      );

      try {
        await markNotificationAsRead(notification.name);
      } catch {
        // Swallowed, exactly as the classic screen does: the row is already
        // marked read locally and the badge already moved.
      }
    },
    [dispatch],
  );

  const closeNotification = useCallback(() => setSelected(null), []);

  /* ---------------------------------------------------------------------
   * Derived
   * ------------------------------------------------------------------- */

  const filtered = useMemo(
    () => filterNotifications(list, searchQuery),
    [list, searchQuery],
  );

  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  return {
    // Values
    list,
    filtered,
    sections,
    selected,
    loading,
    refreshing,
    searchQuery,

    // Setters
    setSearchQuery,

    // Actions
    refresh,
    openNotification,
    closeNotification,

    // Derived
    total: list.length,
    matches: filtered.length,
    unreadCount: countUnread(list),
    isSearching: !!searchQuery.trim(),
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import {
  addNetworkChangeListener,
  fetchIsOnline,
  isOnline as readIsOnline,
} from "../services/offline/NetworkListener";
import {
  addSyncListener,
  isSyncing as readIsSyncing,
  SYNC_PHASE,
} from "../services/offline/AttendanceSyncService";
import {
  addQueueChangeListener,
  getQueueCounts,
  getUnresolvedRows,
} from "../services/offline/AttendanceQueueService";
import {
  describeOfflineStatus,
  OFFLINE_PHASE,
  resolveOfflinePhase,
  SYNCED_VISIBLE_MS,
} from "../utils/offlineStatus";
import {
  addCapabilityListener,
  getOfflineCapability,
  hydrateOfflineCapability,
} from "../services/offline/offlineCapability";
import useOfflineSyncAlerts from "./useOfflineSyncAlerts";

/**
 * Drives the connectivity banner.
 *
 * Entirely event-driven — connectivity edges, sync lifecycle, queue changes —
 * with no polling. A banner that exists to reassure people about a background
 * process must not itself be a background process running a timer every second.
 *
 * The one timer is the success state retiring itself after two seconds, which is
 * a deliberate, bounded delay rather than a poll.
 */
export default function useOfflineStatus() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const employeeCode = useSelector(selectEmployeeCode);
  const { enabled: alertsEnabled } = useOfflineSyncAlerts();
  const [capability, setCapability] = useState(() => getOfflineCapability());

  const [online, setOnline] = useState(() => readIsOnline());
  const [syncing, setSyncing] = useState(() => readIsSyncing());
  // Each count is named for what it means. They used to be one derived
  // `unsynced` shared by three callers wanting three different things, which is
  // exactly how a status added later breaks a consumer silently.
  const [counts, setCounts] = useState({
    pendingCount: 0,
    blockedCount: 0,
    rejectedCount: 0,
    unresolvedCount: 0,
    awaitingServerCount: 0,
  });
  const [justSyncedAt, setJustSyncedAt] = useState(null);

  const isMountedRef = useRef(true);
  const successTimerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const refreshCounts = useCallback(async () => {
    if (!employeeCode) {
      setCounts({
        pendingCount: 0,
        blockedCount: 0,
        rejectedCount: 0,
        unresolvedCount: 0,
        awaitingServerCount: 0,
      });
      return;
    }

    try {
      const next = await getQueueCounts(employeeCode);
      if (!isMountedRef.current) return;
      setCounts({
        pendingCount: next?.pendingCount ?? 0,
        blockedCount: next?.blockedCount ?? 0,
        rejectedCount: next?.rejectedCount ?? 0,
        unresolvedCount: next?.unresolvedCount ?? 0,
        awaitingServerCount: next?.awaitingServerCount ?? 0,
      });
    } catch {
      // A queue read failing is not worth surfacing here — the banner's job is
      // reassurance, and a count it cannot get is better omitted than guessed.
    }
  }, [employeeCode]);

  // Whether this server supports offline attendance at all.
  useEffect(() => {
    hydrateOfflineCapability()
      .then((value) => {
        if (isMountedRef.current) setCapability(value);
      })
      .catch(() => {});

    return addCapabilityListener((value) => {
      if (isMountedRef.current) setCapability(value);
    });
  }, []);

  // Connectivity. Seeded from a real fetch because the cached value can predate
  // the listener starting, and the banner's whole point is being correct at the
  // moment the user looks at it.
  useEffect(() => {
    let cancelled = false;

    fetchIsOnline()
      .then((value) => {
        if (!cancelled && isMountedRef.current) setOnline(value);
      })
      .catch(() => {});

    return addNetworkChangeListener((next) => {
      if (isMountedRef.current) setOnline(next);
    });
  }, []);

  // Sync lifecycle.
  useEffect(
    () =>
      addSyncListener(({ phase, summary }) => {
        if (!isMountedRef.current) return;

        if (phase === SYNC_PHASE.START) {
          setSyncing(true);
          setJustSyncedAt(null);
          return;
        }

        setSyncing(false);

        // Only celebrate something that actually landed. A run that only
        // produced retries or failures has nothing to say "All synced" about.
        const landed = (summary?.synced ?? 0) + (summary?.duplicates ?? 0);
        if (landed > 0) {
          setJustSyncedAt(Date.now());

          if (successTimerRef.current) clearTimeout(successTimerRef.current);
          successTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) setJustSyncedAt(null);
          }, SYNCED_VISIBLE_MS);
        }

        refreshCounts();
      }),
    [refreshCounts],
  );

  // Queue depth.
  useEffect(() => {
    refreshCounts();
    return addQueueChangeListener(refreshCounts);
  }, [refreshCounts]);

  /**
   * Two reasons the administrator banner goes quiet, and neither hides a
   * correction — that one is the employee's to act on and always shows.
   *
   *  - The server has no offline endpoint at all. Then the banner is not a
   *    warning, it is a permanent property of the deployment that every
   *    employee sees forever and none of them can clear. The queue still keeps
   *    and retries the records, and Attendance History still shows each one.
   *  - The employee turned the alerts off in Profile.
   */
  const suppressAdminBanner = capability === false || !alertsEnabled;

  const phase = resolveOfflinePhase({
    online,
    syncing,
    blocked: suppressAdminBanner ? 0 : counts.blockedCount,
    rejected: counts.rejectedCount,
    justSyncedAt,
  });

  // Logged out there is no queue, no employee and nothing to sync, so a
  // connectivity banner would be noise on top of the login screen.
  const visible = isLoggedIn && phase !== OFFLINE_PHASE.HIDDEN;

  /**
   * The rows behind the banner, read on demand.
   *
   * Exposed here rather than queried by the component so the banner needs no
   * store access of its own — it is a presentational overlay, and the hook
   * already knows which employee it is describing.
   */
  const loadUnresolvedRows = useCallback(async () => {
    if (!employeeCode) return [];
    try {
      return await getUnresolvedRows(employeeCode);
    } catch {
      return [];
    }
  }, [employeeCode]);

  const content = visible
    ? describeOfflineStatus(phase, {
        pending: counts.pendingCount,
        blocked: counts.blockedCount,
        rejected: counts.rejectedCount,
        awaitingServer: counts.awaitingServerCount,
      })
    : null;

  return {
    visible,
    phase,
    online,
    syncing,
    content,
    /** Whether tapping the banner should open the detail sheet. */
    actionable: !!content?.actionable,
    /** null until something has been learned; false = no offline endpoint. */
    offlineSyncSupported: capability,
    adminBannerSuppressed: suppressAdminBanner && counts.blockedCount > 0,
    ...counts,
    refreshCounts,
    loadUnresolvedRows,
  };
}

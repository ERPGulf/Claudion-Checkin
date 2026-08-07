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
} from "../services/offline/AttendanceQueueService";
import {
  describeOfflineStatus,
  OFFLINE_PHASE,
  resolveOfflinePhase,
  SYNCED_VISIBLE_MS,
} from "../utils/offlineStatus";

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

  const [online, setOnline] = useState(() => readIsOnline());
  const [syncing, setSyncing] = useState(() => readIsSyncing());
  const [pending, setPending] = useState(0);
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

  const refreshPending = useCallback(async () => {
    if (!employeeCode) {
      setPending(0);
      return;
    }

    try {
      const counts = await getQueueCounts(employeeCode);
      if (!isMountedRef.current) return;
      setPending(counts?.unsynced ?? 0);
    } catch {
      // A queue read failing is not worth surfacing here — the banner's job is
      // reassurance, and a count it cannot get is better omitted than guessed.
    }
  }, [employeeCode]);

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

        refreshPending();
      }),
    [refreshPending],
  );

  // Queue depth.
  useEffect(() => {
    refreshPending();
    return addQueueChangeListener(refreshPending);
  }, [refreshPending]);

  const phase = resolveOfflinePhase({ online, syncing, justSyncedAt });

  // Logged out there is no queue, no employee and nothing to sync, so a
  // connectivity banner would be noise on top of the login screen.
  const visible = isLoggedIn && phase !== OFFLINE_PHASE.HIDDEN;

  return {
    visible,
    phase,
    pending,
    online,
    syncing,
    content: visible ? describeOfflineStatus(phase, { pending }) : null,
  };
}

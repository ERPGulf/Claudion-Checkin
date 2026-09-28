import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSelector } from "react-redux";
import { selectIsLoggedIn } from "../redux/Slices/AuthSlice";
import { selectBaseUrl, selectEmployeeCode } from "../redux/Slices/UserSlice";
import { countRecoveryByScope, listRecoveryRows } from "../services/offline/AttendanceQueueRepository";
import { addQueueChangeListener } from "../services/offline/AttendanceQueueService";
import { addSyncListener, isSyncing } from "../services/offline/AttendanceSyncService";
import { syncNow } from "../services/offline/BackgroundSyncManager";
import { assertAttendanceQueueScope, captureAttendanceQueueScope, normalizeAttendanceTenantKey } from "../services/offline/attendanceQueueProvenance";
import { reconcileAttendanceRow } from "../services/offline/AttendanceVerification";

const READ_ERROR = "Could not read saved attendance. Please try again.";

export default function useAttendanceRecovery() {
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const employeeId = useSelector(selectEmployeeCode);
  const baseUrl = useSelector(selectBaseUrl);
  const identity = JSON.stringify([isLoggedIn, employeeId, baseUrl]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mounted = useRef(false);
  const pressed = useRef(false);
  const since = useRef(null);
  const runRecords = useRef([]);
  const sequence = useRef(0);
  const [state, setState] = useState({ identity, loading: true, counts: null, rows: [], error: null });
  const [busy, setBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(isSyncing);
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState(null);
  const [checkingId, setCheckingId] = useState(null);
  const current = () => mounted.current && identityRef.current === identity;

  const read = useCallback(async () => {
    const scope = await captureAttendanceQueueScope(employeeId);
    if (!isLoggedIn || scope.tenantKey !== normalizeAttendanceTenantKey(baseUrl)) throw new Error("Account changed");
    const [counts, savedRows] = await Promise.all([
      countRecoveryByScope(scope), listRecoveryRows({ ...scope, since: since.current }),
    ]);
    await assertAttendanceQueueScope(scope);
    const rowsById = new Map(savedRows.map(row => [row.id, row]));
    // Immediate outcomes retain successes even if future housekeeping removes
    // them. Persisted SQLite state wins for every row that still exists.
    runRecords.current.forEach(report => {
      const saved = rowsById.get(report.id);
      if (saved || report.status === "synced") rowsById.set(report.id, { ...report, ...saved, photoStatus: report.photoStatus, outcome: report.outcome });
    });
    return { scope, counts, rows: [...rowsById.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id - b.id) };
  }, [isLoggedIn, employeeId, baseUrl]);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await read();
      if (current() && request === sequence.current) setState({ identity, loading: false, error: null, ...next });
      return next;
    } catch {
      if (current() && request === sequence.current) setState({ identity, loading: false, counts: null, rows: [], error: READ_ERROR });
      return null;
    }
  }, [identity, read]);

  useEffect(() => {
    mounted.current = true;
    since.current = null;
    runRecords.current = [];
    setVisible(false);
    setNotice(null);
    setBusy(false);
    setCheckingId(null);
    setBackgroundBusy(isSyncing());
    setState({ identity, loading: true, counts: null, rows: [], error: null });
    refresh();
    const unsubscribeQueue = addQueueChangeListener(refresh);
    const unsubscribeSync = addSyncListener(() => {
      if (current()) { setBackgroundBusy(isSyncing()); refresh(); }
    });
    const appState = AppState.addEventListener("change", next => { if (next === "active") refresh(); });
    return () => { mounted.current = false; sequence.current += 1; unsubscribeQueue(); unsubscribeSync(); appState.remove(); };
  }, [identity, refresh]);

  const sync = useCallback(async () => {
    if (pressed.current || !isLoggedIn) return;
    pressed.current = true;
    setBusy(true);
    setNotice(null);
    let scope;
    try {
      const before = await read();
      scope = before.scope;
      if (!current()) return;
      setVisible(true);
      if (!before.counts.recoverableCount && !before.counts.syncingCount) return;
      since.current = Date.now();
      runRecords.current = [];
      await assertAttendanceQueueScope(scope);
      const result = await syncNow({ employeeId, trigger: "user-sync-pending-attendance" });
      await assertAttendanceQueueScope(scope);
      if (!current()) return;
      runRecords.current = (result?.records ?? []).map(report => ({ ...before.rows.find(row => row.id === report.id), ...report, tenantKey: scope.tenantKey }));
      if (["scope-changed", "another-session-syncing"].includes(result?.reason)) setNotice("Sync stopped because your account/session changed. Saved attendance has not been discarded.");
      else if (result?.reason === "sync-error") setNotice("Could not finish synchronization. Check the saved records below before trying again.");
    } catch {
      if (current()) setNotice("Could not finish synchronization. Your account may have changed, or saved attendance could not be read.");
    } finally {
      if (current()) {
        await refresh();
        setBusy(false);
        setBackgroundBusy(isSyncing());
      }
      pressed.current = false;
    }
  }, [identity, isLoggedIn, employeeId, read, refresh]);

  const verify = useCallback(async (id) => {
    if (pressed.current || !isLoggedIn) return;
    pressed.current = true;
    setCheckingId(id);
    setNotice(null);
    try {
      const result = await reconcileAttendanceRow({ id, employeeId });
      if (current()) setNotice(result.verified
        ? "The matching attendance log was verified on the server."
        : "Could not verify an exact server record. Nothing was resent. This record remains saved; ask your administrator to check the original attendance and company.");
    } catch {
      if (current()) setNotice("Could not check this record. Your session or connection may have changed. Nothing was resent.");
    } finally {
      if (current()) { await refresh(); setCheckingId(null); }
      pressed.current = false;
    }
  }, [identity, isLoggedIn, employeeId, refresh]);

  const safeState = state.identity === identity ? state : { loading: true, counts: null, rows: [], error: null };
  return { ...safeState, isLoggedIn, busy: busy || backgroundBusy, visible: visible && state.identity === identity && isLoggedIn,
    notice, checkingId, verify, sync, refresh, open: () => { setVisible(true); refresh(); }, close: () => setVisible(false) };
}

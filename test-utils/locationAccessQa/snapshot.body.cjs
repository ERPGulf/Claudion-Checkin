const { Platform } = qaRequire('node_modules/react-native/index.js');
const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
const tenant = await storage.getItem('baseUrl');
if (!/^http:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):8765\/?$/.test(tenant || '')) {
  throw new Error('Snapshot is restricted to the disposable localhost QA tenant');
}
const { store } = qaRequire('redux/Store.js');
const state = store.getState();
const native = qaRequire('modules/expo-auto-attendance/index.js');
const session = await qaRequire('utils/attendanceSessionState.js').readSession();
const databaseModule = qaRequire('services/offline/AttendanceDatabase.js');
const database = await databaseModule.getDatabase();
const events = await database.getAllAsync('SELECT eventId, transition, sequence, occurredAt, receivedAt, status, reason, punchTimestamp, queueRowId, outcome, event FROM auto_attendance_events ORDER BY COALESCE(sequence, -1), receivedAt;');
const queue = await database.getAllAsync('SELECT id, employeeId, tenantKey, action, timestamp, status, sourceEventId, serverCheckinId, acceptanceConfirmed, attemptCount, uploadAttemptAt FROM attendance_queue ORDER BY id;');
const pending = native.getPendingEvents();
return { observedAt: new Date().toISOString(), platform: Platform.OS,
  appState: qaRequire('node_modules/react-native/index.js').AppState.currentState,
  tenant, employee: state.user.userDetails?.employeeCode, loggedIn: state.userAuth.isLoggedIn,
  featureSettings: state.featureSettings, employeePolicy: state.autoAttendance?.employeePolicy,
  monitoring: state.autoAttendance?.monitoring, registered: native.getRegisteredGeofences(),
  session, nativePending: pending, queue,
  events: events.map(row => ({ ...row, event: JSON.parse(row.event), outcome: row.outcome ? JSON.parse(row.outcome) : null })) };

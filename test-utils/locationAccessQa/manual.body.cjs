// Host-side invocation of the same guarded manual service used by the screen.
// It performs real policy checks, location reads, authenticated HTTP, and the
// shared durable transition. No session/queue/native receipt is manufactured.
const storage = qaRequire('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
const tenant = await storage.getItem('baseUrl');
if (tenant !== 'http://10.0.2.2:8765') throw new Error('Android disposable QA tenant required');
const { store } = qaRequire('redux/Store.js');
const employeeCode = store.getState().user.userDetails?.employeeCode;
if (employeeCode !== 'QA-ANDROID-001' || !['IN', 'OUT'].includes(qaArgs.type)) {
  throw new Error('Expected the disposable Android employee and a manual punch type');
}
const { performManualAttendanceTransition } = qaRequire('services/offline/ManualAttendanceService.js');
const { userCheckIn } = qaRequire('services/api/attendance.service.js');
const outcome = await performManualAttendanceTransition({ type: qaArgs.type, employeeCode,
  online: ({ scope, occurredAt }) => userCheckIn({ employeeCode, type: qaArgs.type,
    syncScope: scope, occurredAt }) });
return { status: outcome.status, session: outcome.session, queued: outcome.queued,
  serverConfirmed: outcome.serverConfirmed, allowed: outcome.response?.allowed,
  reason: outcome.response?.reason, serverRecord: outcome.response?.name };

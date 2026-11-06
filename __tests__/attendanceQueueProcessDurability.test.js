/** @jest-environment jsdom */
jest.mock('expo-sqlite', () => require('../test-utils/expoSqliteMock'));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDatabase, resetDatabaseHandle } from '../services/offline/AttendanceDatabase';
import { enqueue, markRejected } from '../services/offline/AttendanceQueueRepository';

const { __resetAll } = require('../test-utils/expoSqliteMock');

it('survives real WAL process exits using the actual admission and rejection statements', async () => {
  __resetAll();
  resetDatabaseHandle();
  const input = { tenantKey: 'https://wal-synthetic.example', employeeId: 'WAL-SYNTHETIC',
    attendanceType: 'auto', action: 'checkin', timestamp: '2026-11-05 09:00:00', sourceEventId: 'wal-parent' };
  const parent = (await enqueue(input)).row;
  const database = await getDatabase();
  const schema = (await database.getAllAsync("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC;"))
    .map(row => row.sql);
  const seed = await database.getAllAsync('SELECT * FROM attendance_queue ORDER BY id;');
  const fixture = { schema, seed };
  const run = database.runAsync;
  const all = database.getAllAsync;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-sql-fixture-'));
  try {
    database.runAsync = async (sql, params) => {
      if (sql.includes('INSERT INTO attendance_queue')) fixture.admission = { sql, params };
      return run(sql, params);
    };
    await enqueue({ ...input, action: 'checkout', timestamp: '2026-11-05 17:00:00', sourceEventId: 'wal-child',
      payload: { sourceParentEventId: 'wal-parent' } });
    database.getAllAsync = async (sql, params) => {
      if (sql.includes('UPDATE attendance_queue')) fixture.rejection = { sql, params };
      return all(sql, params);
    };
    await markRejected({ id: parent.id, error: 'synthetic refusal' });
    const file = path.join(directory, 'captured-statements.json');
    fs.writeFileSync(file, JSON.stringify(fixture));
    const result = JSON.parse(execFileSync(process.execPath,
      [path.resolve(__dirname, '../native-tests/sqlite/queue-process-crashes.cjs'), file],
      { encoding: 'utf8', timeout: 30000 }));
    expect(result.passed).toHaveLength(6);
    expect(result.sqliteVersion).toMatch(/^3\./);
  } finally {
    database.runAsync = run;
    database.getAllAsync = all;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

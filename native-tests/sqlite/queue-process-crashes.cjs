// Uses Node's installed SQLite engine against disposable WAL files. The fixture
// contains schema/statements captured from production JS, not copied SQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const [fixturePath, mode, databasePath, operation] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const open = filename => {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  return db;
};
const execute = (db, statement) => {
  const query = db.prepare(statement.sql);
  // Drain RETURNING before exiting, so the statement's commit really finished.
  query.all(...statement.params);
};

if (mode === 'child') {
  // SIGKILL, not process.exit: no close, checkpoint, destructor or exit hook can
  // run, whatever a future Node does on exit. The marker is written
  // synchronously because pipe writes are asynchronous on macOS.
  const kill = () => process.kill(process.pid, 'SIGKILL');
  const db = open(databasePath);
  db.function('terminate_process', kill);
  execute(db, fixture[operation]);
  fs.writeSync(1, 'committed');
  kill();
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-queue-wal-'));
const passed = [];
try {
  const seed = name => {
    const file = path.join(directory, `${name}.db`);
    const db = open(file);
    for (const sql of fixture.schema) db.exec(sql);
    for (const row of fixture.seed) {
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO attendance_queue (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(key => row[key]));
    }
    return { file, db };
  };
  const run = (file, op, { committed }) => {
    const child = spawnSync(process.execPath,
      [__filename, fixturePath, 'child', file, op], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.equal(child.stdout, committed ? 'committed' : '');
    // A committed write must still be only in the WAL, so reopen exercises
    // crash recovery rather than a checkpoint performed by a clean close.
    if (committed) assert.ok(fs.statSync(`${file}-wal`).size > 0, 'commit was checkpointed before kill');
  };
  const rows = db => db.prepare('SELECT * FROM attendance_queue ORDER BY id').all();
  const healthy = db => assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const paired = db => {
    const [parent, child] = rows(db);
    assert.equal(child.pairedAttendanceId, parent.id);
    assert.equal(parent.pairedAttendanceId, child.id);
    assert.equal(parent.sessionId, child.sessionId);
    return [parent, child];
  };

  {
    const { file, db } = seed('after-admission');
    db.close();
    run(file, 'admission', { committed: true });
    const reopened = open(file);
    paired(reopened);
    healthy(reopened);
    reopened.close();
    passed.push('kill after admission commit retains both pair links');
  }
  // The statement inserts the checkout first and links the parent last: kill
  // at each write, so neither the unlinked child nor the parent link survives.
  for (const [name, trigger] of [
    ['child insert', `AFTER INSERT ON attendance_queue WHEN NEW.action = 'checkout'`],
    ['parent link', `AFTER UPDATE OF pairedAttendanceId ON attendance_queue WHEN NEW.action = 'checkin'`],
  ]) {
    const { file, db } = seed(`during-admission-${name.replace(' ', '-')}`);
    db.exec(`CREATE TRIGGER crash_admission ${trigger} BEGIN SELECT terminate_process(); END;`);
    db.close();
    run(file, 'admission', { committed: false });
    const reopened = open(file);
    assert.equal(rows(reopened).length, 1);
    assert.equal(rows(reopened)[0].pairedAttendanceId, null);
    healthy(reopened);
    reopened.close();
    passed.push(`kill at admission ${name} rolls back child and links`);
  }
  {
    const { file, db } = seed('after-rejection');
    execute(db, fixture.admission);
    db.close();
    run(file, 'rejection', { committed: true });
    const reopened = open(file);
    assert.deepEqual(paired(reopened).map(row => row.status), ['rejected', 'rejected']);
    healthy(reopened);
    reopened.close();
    passed.push('kill after rejection commit retains parent and dependent outcome');
  }
  {
    const { file, db } = seed('during-rejection');
    execute(db, fixture.admission);
    db.exec(`CREATE TRIGGER crash_rejection AFTER UPDATE OF status ON attendance_queue
      WHEN NEW.id = ${Number(fixture.seed[0].id)} AND NEW.status = 'rejected'
      BEGIN SELECT terminate_process(); END;`);
    db.close();
    run(file, 'rejection', { committed: false });
    const reopened = open(file);
    assert.deepEqual(paired(reopened).map(row => row.status), ['pending', 'pending']);
    healthy(reopened);
    reopened.close();
    passed.push('kill inside rejection cannot expose a partial cascade');
  }
  {
    const { db } = seed('duplicate-admission');
    execute(db, fixture.admission);
    execute(db, fixture.admission);
    assert.equal(rows(db).length, 2);
    paired(db);
    healthy(db);
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
    db.close();
    passed.push('duplicate admission preserves original pair without another row');
    process.stdout.write(JSON.stringify({ sqliteVersion, passed }));
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

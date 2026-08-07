/* eslint-disable no-undef */
/**
 * An `expo-sqlite` stand-in backed by real SQLite (`sql.js` — SQLite compiled to
 * WebAssembly, a dev dependency that never reaches the bundle).
 *
 * A hand-written fake would only prove the fake behaves as expected. The parts
 * of the queue that most need proving are SQL: the UNIQUE index that makes
 * enqueue idempotent, and the `UPDATE … RETURNING` that claims a row atomically
 * so two drains cannot take the same punch. Both are database semantics, so the
 * tests run against a database.
 *
 * WASM rather than a native binding because the native one needs a working
 * node-gyp toolchain to install (`better-sqlite3` fails to build here), and a
 * test helper that only works on one machine is worse than no test helper.
 *
 * **A suite using this must declare `@jest-environment jsdom`.** Under this
 * project's default `node` environment, `new SQL.Database()` fails inside the
 * emscripten runtime and reports an empty error message that names nothing —
 * the docblock is the whole fix, but it is impossible to guess from the symptom.
 *
 * Lives outside `__tests__/` because jest's default `testMatch` collects
 * everything in there and would report this file as a suite with no tests.
 */
const fs = require("fs");
const initSqlJs = require("sql.js");

let sqlPromise = null;
const databases = new Map();

const loadSql = () => {
  if (!sqlPromise) {
    // Handed the binary directly rather than left to sql.js's own `locateFile`
    // loader, which resolves differently inside jest's module sandbox.
    sqlPromise = initSqlJs({
      wasmBinary: fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")),
    });
  }
  return sqlPromise;
};

/** sql.js rejects `undefined`; expo-sqlite is happy to bind it as NULL. */
const normalizeParams = (params) =>
  (Array.isArray(params) ? params : []).map((value) =>
    value === undefined ? null : value,
  );

const wrap = (db) => ({
  execAsync: async (sql) => {
    db.exec(sql);
  },

  runAsync: async (sql, params) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(normalizeParams(params));
      // `step()` rather than `run()`: a write that also returns rows (RETURNING)
      // has to be stepped for the write to happen at all.
      while (statement.step()) {
        // Drain any returned rows; the caller of runAsync does not want them.
      }
    } finally {
      statement.free();
    }

    const [result] = db.exec("SELECT last_insert_rowid() AS id;");

    return {
      changes: db.getRowsModified(),
      lastInsertRowId: Number(result?.values?.[0]?.[0] ?? 0),
    };
  },

  getFirstAsync: async (sql, params) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(normalizeParams(params));
      return statement.step() ? statement.getAsObject() : null;
    } finally {
      statement.free();
    }
  },

  getAllAsync: async (sql, params) => {
    const statement = db.prepare(sql);
    const rows = [];
    try {
      statement.bind(normalizeParams(params));
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  },

  closeAsync: async () => db.close(),
});

const openDatabaseAsync = async (name) => {
  if (!databases.has(name)) {
    const SQL = await loadSql();
    // In-memory, so each test run starts clean and nothing touches the disk.
    databases.set(name, wrap(new SQL.Database()));
  }
  return databases.get(name);
};

/** Drops every open database. Call between tests that share a module handle. */
const __resetAll = () => {
  databases.forEach((db) => {
    try {
      db.closeAsync();
    } catch {
      // Already closed.
    }
  });
  databases.clear();
};

module.exports = {
  __esModule: true,
  openDatabaseAsync,
  __resetAll,
};

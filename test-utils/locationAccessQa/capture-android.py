#!/usr/bin/env python3
"""Read-only host evidence from the dedicated disposable emulator only."""
import datetime
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile

label = sys.argv[1]
if not re.fullmatch(r"[A-Za-z0-9_-]+", label):
    raise SystemExit("Invalid evidence label")
adb = ["adb", "-s", "emulator-5560"]
bundle = "com.bazim.claudioncheckin"
native = subprocess.check_output(adb + ["exec-out", "run-as", bundle, "cat", "shared_prefs/expo_auto_attendance.xml"])
if b"QA-ANDROID-001" not in native or b"10.0.2.2:8765" not in native:
    raise SystemExit("Expected the disposable Android employee and localhost tenant")
output = Path(__file__).resolve().parents[2] / "docs/testing/location-access-emulator-2026-10-30/android" / label
output.mkdir(parents=True, exist_ok=True)
(output / "captured-at.txt").write_text(datetime.datetime.now(datetime.timezone.utc).isoformat() + "\n")
(output / "native-journal.xml").write_bytes(native)
with tempfile.TemporaryDirectory(prefix="claudion-qa-attendance-") as temporary:
    database = Path(temporary) / "claudion-attendance.db"
    for suffix in ("", "-wal", "-shm"):
        data = subprocess.check_output(adb + ["exec-out", "run-as", bundle, "cat", f"files/SQLite/claudion-attendance.db{suffix}"])
        Path(str(database) + suffix).write_bytes(data)
    connection = sqlite3.connect(str(database))
    connection.row_factory = sqlite3.Row
    snapshot = {"userVersion": connection.execute("PRAGMA user_version").fetchone()[0]}
    for table in ("auto_attendance_events", "attendance_queue"):
        rows = [dict(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")]
        for row in rows:
            for key in ("event", "payload", "outcome", "serverResponse"):
                if isinstance(row.get(key), str):
                    try:
                        row[key] = json.loads(row[key])
                    except ValueError:
                        pass
        snapshot[table] = rows
    connection.close()
    (output / "sqlite.json").write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n")
(output / "screen.png").write_bytes(subprocess.check_output(adb + ["exec-out", "screencap", "-p"]))
print(output)

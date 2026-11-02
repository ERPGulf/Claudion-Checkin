#!/bin/sh
# Host-only evidence collection. Use only the disposable QA simulator.
set -eu
qa_udid=${QA_IOS_UDID:-FC19E559-3811-4ACF-B5E9-0933E113C411}
qa_bundle=com.bazim.claudioncheckin
qa_label=${1:?Usage: capture-ios.sh PHASE}
case "$qa_label" in *[!a-zA-Z0-9_-]*) echo "Invalid phase label" >&2; exit 2 ;; esac
# A read-only export still must not copy a user's app data accidentally.
xcrun simctl list devices --json | python3 -c '
import json, sys
devices = [d for group in json.load(sys.stdin)["devices"].values() for d in group]
matches = [d for d in devices if d["udid"] == sys.argv[1]]
if len(matches) != 1 or not matches[0]["name"].startswith("Claudion Location Access QA"):
    sys.exit("Refusing to export a simulator outside the disposable Claudion QA set")
' "$qa_udid"
qa_repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
qa_out="$qa_repo/docs/testing/location-access-emulator-2026-10-30/ios/$qa_label"
mkdir -p "$qa_out"
qa_container=$(xcrun simctl get_app_container "$qa_udid" "$qa_bundle" data)
python3 - "$qa_container" "$qa_out" <<'PYTHON'
import datetime, json, pathlib, sqlite3, sys
container, output = map(pathlib.Path, sys.argv[1:])
(output/'captured-at.txt').write_text(datetime.datetime.now(datetime.timezone.utc).isoformat()+'\n')
journal=container/'Library/Application Support/ExpoAutoAttendance/pending-events.json'
if journal.exists():
    (output/'native-journal.json').write_text(json.dumps(json.loads(journal.read_text()), indent=2, ensure_ascii=False)+'\n')
else:
    (output/'native-journal-missing.txt').write_text('No native journal file yet.\n')
databases=list(container.glob('**/claudion-attendance.db'))
if len(databases)!=1:
    (output/'sqlite-missing.txt').write_text(f'Found {len(databases)} attendance databases.\n')
else:
    connection=sqlite3.connect(databases[0].as_uri()+'?mode=ro',uri=True)
    connection.row_factory=sqlite3.Row
    snapshot={'userVersion':connection.execute('PRAGMA user_version').fetchone()[0]}
    for table in ['auto_attendance_events','attendance_queue']:
        rows=[dict(row) for row in connection.execute(f'SELECT * FROM {table} ORDER BY rowid')]
        for row in rows:
            for key in ['event','payload','outcome','serverResponse']:
                if isinstance(row.get(key),str):
                    try: row[key]=json.loads(row[key])
                    except (ValueError,TypeError): pass
        snapshot[table]=rows
    (output/'sqlite.json').write_text(json.dumps(snapshot,indent=2,ensure_ascii=False)+'\n')
PYTHON
qa_screen="${TMPDIR:-/tmp}/claudion-ios-qa-${qa_label}-$$.png"
xcrun simctl io "$qa_udid" screenshot "$qa_screen"
mv "$qa_screen" "$qa_out/screen.png"
printf '%s\n' "$qa_out"

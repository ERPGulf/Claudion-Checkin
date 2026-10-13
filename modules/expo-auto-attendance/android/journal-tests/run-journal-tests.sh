#!/bin/sh
set -eu

# Test-only JSON-java jar argument; no project dependency is added or installed.
json_jar=${1:?Pass the path to a JSON-java org.json jar}
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir="$test_dir/../src/main/java/expo/modules/autoattendance"
output_dir=$(mktemp -d "${TMPDIR:-/tmp}/attendance-journal-tests.XXXXXX")
trap 'rm -rf "$output_dir"' EXIT HUP INT TERM

kotlinc -classpath "$json_jar" \
  "$source_dir/GeofenceEventJournal.kt" \
  "$source_dir/GeofenceStore.kt" \
  "$test_dir/AndroidStorageTestAdapter.kt" \
  "$test_dir/GeofenceJournalHarness.kt" \
  -include-runtime -d "$output_dir/journal-tests.jar"
java -cp "$output_dir/journal-tests.jar:$json_jar" expo.modules.autoattendance.GeofenceJournalHarnessKt

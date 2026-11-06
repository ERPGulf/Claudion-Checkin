#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir=$(mktemp -d "${TMPDIR:-/tmp}/attendance-ios-wake-tests.XXXXXX")
trap 'rm -rf "$output_dir"' EXIT HUP INT TERM

sdk_path=$(xcrun --sdk macosx --show-sdk-path)
xcrun --sdk macosx swiftc -sdk "$sdk_path" -module-cache-path "$output_dir/module-cache" \
  "$test_dir/../ios/AttendanceBackgroundSyncState.swift" \
  "$test_dir/main.swift" -o "$output_dir/wake-tests"
"$output_dir/wake-tests"

# Execute native notification/lease wiring against a host-only UIKit adapter.
# The production coordinator/event bus are compiled unchanged, without DEBUG so
# this host test cannot write the app's optional diagnostic UserDefaults ring.
xcrun --sdk macosx swiftc -sdk "$sdk_path" -module-cache-path "$output_dir/module-cache" \
  -emit-library -emit-module -module-name UIKit \
  "$test_dir/UIKitTestAdapter.swift" -o "$output_dir/libUIKit.dylib" \
  -emit-module-path "$output_dir/UIKit.swiftmodule"
xcrun --sdk macosx swiftc -sdk "$sdk_path" -module-cache-path "$output_dir/module-cache" \
  -I "$output_dir" -L "$output_dir" -lUIKit -Xlinker -rpath -Xlinker "$output_dir" \
  "$test_dir/../ios/AttendanceBackgroundSyncState.swift" \
  "$test_dir/../ios/AttendanceBackgroundSync.swift" \
  "$test_dir/../ios/GeofenceEventBus.swift" \
  "$test_dir/CoordinatorHarness.swift" -o "$output_dir/coordinator-tests"
"$output_dir/coordinator-tests"

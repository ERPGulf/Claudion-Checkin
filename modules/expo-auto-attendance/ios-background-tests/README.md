# iOS background wake ownership regression

Run `sh modules/expo-auto-attendance/ios-background-tests/run-tests.sh` from the
repository root. It compiles and executes the production Foundation ownership
state with the installed Swift toolchain; no dependencies are installed.

The harness checks cold-start latching, coalesced capture revisions, a fixed
application cap, matching completion, subsequent warm wakes, stale completion
and timer isolation, OS expiration, elapsed deadlines, and concurrent reads/
captures. It does not establish UIKit execution allowance, Core Location
delivery, React startup, HTTP delivery, or behavior on a physical iPhone.

A second harness executes the production coordinator/event bus against a small
host-only UIKit adapter. It checks passive RNFirebase notification registration,
cold/warm push wakes, push/location coalescing, synchronous expiration, stale
completion/expiration isolation, assertion refusal, foreground behavior, and the
absence of manufactured attendance events or remote-message payload forwarding.
The adapter is outside the pod source directory and cannot ship in the app.

The deadline is an application cap. iOS may expire or refuse an assertion sooner.
Neither expiration nor completion of execution acknowledges an attendance record;
native journal/SQLite persistence and server confirmation remain separate.

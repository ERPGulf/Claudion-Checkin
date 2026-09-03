import { format } from 'date-fns';
import {
  OFFLINE_PHASE,
  STALE_PENDING_MS,
  SYNCED_VISIBLE_MS,
  describeOfflineStatus,
  describeOfflineStatusForA11y,
  describeQueueDiagnostics,
  describeQueueRow,
  resolveOfflinePhase,
} from '../utils/offlineStatus';

describe('resolveOfflinePhase', () => {
  it('says nothing when online, idle and nothing is queued', () => {
    expect(resolveOfflinePhase({ online: true })).toBe(OFFLINE_PHASE.HIDDEN);
  });

  it('shows the offline state with no connection', () => {
    expect(resolveOfflinePhase({ online: false })).toBe(OFFLINE_PHASE.OFFLINE);
  });

  it('shows the syncing state while a drain runs', () => {
    expect(resolveOfflinePhase({ online: true, syncing: true })).toBe(
      OFFLINE_PHASE.SYNCING,
    );
  });

  // The drain is about to stop anyway, and "You're offline" is the more useful
  // of the two things that are simultaneously true.
  it('lets offline outrank an in-flight sync', () => {
    expect(resolveOfflinePhase({ online: false, syncing: true })).toBe(
      OFFLINE_PHASE.OFFLINE,
    );
  });

  it('shows the success state briefly after a sync lands', () => {
    const at = 1_000_000;
    expect(
      resolveOfflinePhase({ online: true, justSyncedAt: at, now: at + 500 }),
    ).toBe(OFFLINE_PHASE.SYNCED);
  });

  it('retires the success state after two seconds', () => {
    const at = 1_000_000;
    expect(
      resolveOfflinePhase({
        online: true,
        justSyncedAt: at,
        now: at + SYNCED_VISIBLE_MS,
      }),
    ).toBe(OFFLINE_PHASE.HIDDEN);
  });

  it('ignores a nullish sync timestamp rather than showing success forever', () => {
    expect(resolveOfflinePhase({ online: true, justSyncedAt: null })).toBe(
      OFFLINE_PHASE.HIDDEN,
    );
  });
});

describe('describeOfflineStatus', () => {
  it('renders nothing for the hidden phase', () => {
    expect(describeOfflineStatus(OFFLINE_PHASE.HIDDEN)).toBeNull();
  });

  describe('offline', () => {
    it('reassures rather than alarms when nothing is queued', () => {
      const content = describeOfflineStatus(OFFLINE_PHASE.OFFLINE);

      expect(content.title).toBe("You're offline");
      expect(content.subtitle).toBe(
        "Attendance will sync automatically when you're back online.",
      );
    });

    // Amber, not red: nothing has gone wrong and nothing is lost.
    it('uses the warning tone, never the error one', () => {
      expect(describeOfflineStatus(OFFLINE_PHASE.OFFLINE).tone).toBe('warning');
    });

    it('reports the queue depth once there is one', () => {
      expect(
        describeOfflineStatus(OFFLINE_PHASE.OFFLINE, { pending: 3 }).subtitle,
      ).toBe('3 attendance records waiting to sync');
    });

    it('says "record", singular, for one', () => {
      expect(
        describeOfflineStatus(OFFLINE_PHASE.OFFLINE, { pending: 1 }).subtitle,
      ).toBe('1 attendance record waiting to sync');
    });

    it('pulses the trailing glyph', () => {
      const content = describeOfflineStatus(OFFLINE_PHASE.OFFLINE);
      expect(content.motion).toBe('pulse');
      expect(content.trailingIcon).toBe('cloud-upload-outline');
    });
  });

  describe('syncing', () => {
    it('spins the trailing glyph', () => {
      const content = describeOfflineStatus(OFFLINE_PHASE.SYNCING);

      expect(content.title).toBe('Syncing attendance…');
      expect(content.motion).toBe('spin');
      expect(content.tone).toBe('info');
    });

    it('counts down what is left', () => {
      expect(
        describeOfflineStatus(OFFLINE_PHASE.SYNCING, { pending: 2 }).subtitle,
      ).toBe('2 records remaining');
    });
  });

  describe('synced', () => {
    it('is a single green line with no trailing animation', () => {
      const content = describeOfflineStatus(OFFLINE_PHASE.SYNCED);

      expect(content.title).toBe('All attendance synced');
      expect(content.tone).toBe('success');
      expect(content.subtitle).toBeNull();
      expect(content.trailingIcon).toBeNull();
      expect(content.motion).toBe('none');
    });
  });

  it('only ever uses tones the palette defines', () => {
    // `colors[`${tone}Surface`]` would be undefined otherwise and the pill would
    // render with no background at all.
    const valid = ['success', 'info', 'warning', 'error', 'neutral'];

    [
      OFFLINE_PHASE.OFFLINE,
      OFFLINE_PHASE.SYNCING,
      OFFLINE_PHASE.SYNCED,
    ].forEach(phase => {
      expect(valid).toContain(describeOfflineStatus(phase).tone);
    });
  });
});

// The two persistent states. They outrank being offline because offline
// resolves itself and these do not.
describe('needs administrator', () => {
  it('never says "failed" — nothing failed and nothing is lost', () => {
    const content = describeOfflineStatus(OFFLINE_PHASE.NEEDS_ADMIN, {
      blocked: 1,
    });

    expect(content.title).toBe('Waiting for your administrator');
    expect(content.subtitle).toMatch(/keep trying automatically/);
    expect(`${content.title} ${content.subtitle}`).not.toMatch(/fail/i);
  });

  // Amber, not red: the record is safe and still being retried.
  it('uses the warning tone, not the error one', () => {
    expect(describeOfflineStatus(OFFLINE_PHASE.NEEDS_ADMIN, { blocked: 2 }).tone)
      .toBe('warning');
  });

  it('is tappable, because there is something to explain', () => {
    expect(
      describeOfflineStatus(OFFLINE_PHASE.NEEDS_ADMIN, { blocked: 1 }).actionable,
    ).toBe(true);
  });
});

describe('needs correction', () => {
  it('is the one red state — it will not resolve itself', () => {
    const content = describeOfflineStatus(OFFLINE_PHASE.NEEDS_CORRECTION, {
      rejected: 1,
    });

    expect(content.tone).toBe('error');
    expect(content.title).toBe('1 attendance record needs correction');
    expect(content.actionable).toBe(true);
  });

  it('agrees its verb with the count', () => {
    expect(
      describeOfflineStatus(OFFLINE_PHASE.NEEDS_CORRECTION, { rejected: 2 }).title,
    ).toBe('2 attendance records need correction');
  });
});

describe('precedence', () => {
  // A rejected record needs a person; being offline needs only time, and the OS
  // status bar already says so.
  it('puts a correction above being offline', () => {
    expect(resolveOfflinePhase({ online: false, rejected: 1 })).toBe(
      OFFLINE_PHASE.NEEDS_CORRECTION,
    );
  });

  it('puts a correction above an administrator block', () => {
    expect(resolveOfflinePhase({ online: true, blocked: 2, rejected: 1 })).toBe(
      OFFLINE_PHASE.NEEDS_CORRECTION,
    );
  });

  it('puts an administrator block above being offline', () => {
    expect(resolveOfflinePhase({ online: false, blocked: 1 })).toBe(
      OFFLINE_PHASE.NEEDS_ADMIN,
    );
  });

  // Persistent by design: these do not time out like the success chip.
  it('keeps showing while a sync runs', () => {
    expect(resolveOfflinePhase({ online: true, syncing: true, blocked: 1 })).toBe(
      OFFLINE_PHASE.NEEDS_ADMIN,
    );
  });
});

describe('describeOfflineStatusForA11y', () => {
  it('joins the two visual lines into one announcement', () => {
    expect(
      describeOfflineStatusForA11y(
        describeOfflineStatus(OFFLINE_PHASE.OFFLINE, { pending: 2 }),
      ),
    ).toBe("You're offline. 2 attendance records waiting to sync");
  });

  it('handles a single-line phase without a trailing separator', () => {
    expect(
      describeOfflineStatusForA11y(describeOfflineStatus(OFFLINE_PHASE.SYNCED)),
    ).toBe('All attendance synced');
  });
});

/**
 * The state that had no banner.
 *
 * Six punches sat `pending` on a production phone for a day: past the offline
 * banner (the phone was back on wifi), short of the administrator banner
 * (nothing was blocked), and so the app said nothing at all while the only
 * screen that showed them offered no way to ask why.
 */
describe('the waiting phase', () => {
  const hourOld = { pending: 1, oldestPendingAt: 0, now: STALE_PENDING_MS };

  it('stays quiet while a punch is queueing normally', () => {
    expect(
      resolveOfflinePhase({
        online: true,
        pending: 1,
        oldestPendingAt: 0,
        now: STALE_PENDING_MS - 1,
      }),
    ).toBe(OFFLINE_PHASE.HIDDEN);
  });

  it('speaks up once the oldest row outlives the retry ladder', () => {
    expect(resolveOfflinePhase({ online: true, ...hourOld })).toBe(
      OFFLINE_PHASE.WAITING,
    );
  });

  // Every other phase explains the same records better.
  it('yields to offline, syncing and the two persistent states', () => {
    expect(resolveOfflinePhase({ online: false, ...hourOld })).toBe(
      OFFLINE_PHASE.OFFLINE,
    );
    expect(
      resolveOfflinePhase({ online: true, syncing: true, ...hourOld }),
    ).toBe(OFFLINE_PHASE.SYNCING);
    expect(resolveOfflinePhase({ online: true, blocked: 1, ...hourOld })).toBe(
      OFFLINE_PHASE.NEEDS_ADMIN,
    );
    expect(resolveOfflinePhase({ online: true, rejected: 1, ...hourOld })).toBe(
      OFFLINE_PHASE.NEEDS_CORRECTION,
    );
  });

  // The caller passes null to suppress it — a tenant with no offline endpoint,
  // or an employee who has turned sync alerts off.
  it('is suppressible', () => {
    expect(
      resolveOfflinePhase({ online: true, pending: 6, oldestPendingAt: null }),
    ).toBe(OFFLINE_PHASE.HIDDEN);
  });

  it('leads with the reassurance and offers a way in', () => {
    const content = describeOfflineStatus(OFFLINE_PHASE.WAITING, { pending: 6 });

    expect(content.title).toBe('Attendance still waiting to sync');
    expect(content.subtitle).toBe(
      '6 attendance records saved on your device. Tap for details.',
    );
    // Without this the diagnostics below are unreachable.
    expect(content.actionable).toBe(true);
    expect(content.tone).toBe('warning');
  });
});

/**
 * The support line. What made "is this row being retried or has it never been
 * attempted?" answerable from a screenshot instead of a debugger.
 */
describe('describeQueueDiagnostics', () => {
  it('names the row, its state, its attempts and its next attempt', () => {
    const nextAttemptAt = new Date('2026-09-03T14:07:00Z').getTime();
    const line = describeQueueDiagnostics(
      { id: 12, status: 'pending', retryCount: 3, nextAttemptAt },
      { now: new Date('2026-09-03T13:00:00Z').getTime() },
    );

    expect(line).toContain('#12');
    expect(line).toContain('pending');
    expect(line).toContain('3 attempts');
    // Formatted in the device's own zone, so the expectation is derived rather
    // than hardcoded — this suite runs wherever the developer happens to be.
    expect(line).toContain(`next ${format(new Date(nextAttemptAt), 'HH:mm')}`);
  });

  it('distinguishes a row nothing has tried from one mid-backoff', () => {
    expect(
      describeQueueDiagnostics({ id: 1, status: 'pending', retryCount: 0, nextAttemptAt: 0 }),
    ).toBe('#1 · pending · no attempts yet · due now');
  });

  it('carries the failure class when there is one', () => {
    expect(
      describeQueueDiagnostics({
        id: 4,
        status: 'blocked',
        failureClass: 'endpoint-missing',
        retryCount: 1,
        nextAttemptAt: 0,
      }),
    ).toBe('#4 · blocked/endpoint-missing · 1 attempt · due now');
  });

  // A rejected row is never retried; promising a next attempt would be a lie.
  it('omits a next attempt where there will not be one', () => {
    const line = describeQueueDiagnostics({
      id: 7,
      status: 'rejected',
      failureClass: 'validation',
      retryCount: 2,
    });

    expect(line).toBe('#7 · rejected/validation · 2 attempts');
  });

  // Frappe exception text stays in the log. This line is shown to employees.
  it('never leaks the server error', () => {
    const line = describeQueueDiagnostics({
      id: 9,
      status: 'blocked',
      retryCount: 1,
      error: 'frappe.exceptions.ValidationError: Employee is inactive',
    });

    expect(line).not.toMatch(/frappe|ValidationError|inactive/);
  });

  it('has nothing to say about a row that does not exist', () => {
    expect(describeQueueDiagnostics(null)).toBeNull();
  });
});

/**
 * The employee-facing copy is unchanged by the diagnostics addition — the two
 * are deliberately separate, one prose and one terse.
 */
describe('describeQueueRow alongside the diagnostics', () => {
  it('still explains a pending row without jargon', () => {
    const detail = describeQueueRow({ id: 3, status: 'pending', retryCount: 4 });

    expect(detail.label).toBe('Pending sync');
    expect(detail.reason).toBe('Saved on your device, waiting to be sent.');
    expect(detail.reason).not.toMatch(/pending|attempt|#3/);
  });
});

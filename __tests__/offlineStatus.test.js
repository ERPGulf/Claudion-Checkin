import {
  OFFLINE_PHASE,
  SYNCED_VISIBLE_MS,
  describeOfflineStatus,
  describeOfflineStatusForA11y,
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

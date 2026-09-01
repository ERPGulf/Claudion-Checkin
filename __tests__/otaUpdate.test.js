import {
  UPDATE_SOURCE,
  describeRunningUpdate,
  formatUpdateAge,
  formatUpdateDate,
  shortUpdateId,
} from '../utils/otaUpdate';

/**
 * The Profile screen's answer to "which JS is this device running?".
 *
 * The native version does not change when an OTA lands, so two devices both
 * reporting `1.2.0 (12)` can be running code published weeks apart. These pin
 * the three states a device can be in, because the one that matters most —
 * "no update has been applied yet" — is exactly the one a naive implementation
 * renders as a confident-looking date.
 */

// Built from local components so the formatted strings below do not depend on
// the timezone the suite happens to run in.
const NOW = new Date(2026, 8, 4, 12, 0);
const PUBLISHED = new Date(2026, 8, 1, 9, 30);

describe('formatUpdateDate', () => {
  it('formats a Date', () => {
    expect(formatUpdateDate(new Date(2026, 8, 1, 14, 32))).toBe(
      '1 Sep 2026, 02:32 PM',
    );
  });

  it('accepts the string and epoch forms too', () => {
    const at = new Date(2026, 8, 1, 14, 32);
    expect(formatUpdateDate(at.toISOString())).toBe('1 Sep 2026, 02:32 PM');
    expect(formatUpdateDate(at.getTime())).toBe('1 Sep 2026, 02:32 PM');
  });

  it.each([null, undefined, '', 'not a date', NaN])(
    'returns null for %p',
    (value) => {
      expect(formatUpdateDate(value)).toBeNull();
    },
  );
});

describe('formatUpdateAge', () => {
  it('reads as elapsed time', () => {
    expect(formatUpdateAge(PUBLISHED, NOW)).toBe('3 days ago');
  });

  // A published-in-the-future date means the device clock is wrong. "in 3 hours"
  // reads as a bug in the app rather than as a bug in the clock.
  it('says nothing when the timestamp is in the future', () => {
    expect(formatUpdateAge(new Date(2026, 8, 5, 12, 0), NOW)).toBeNull();
  });

  // A little skew is normal and should not blank the row. The wording is a
  // shade off for a timestamp 30 seconds ahead, which is a better outcome than
  // either hiding it or printing "in 30 seconds".
  it('tolerates a minute of clock skew', () => {
    const barelyAhead = new Date(NOW.getTime() + 30_000);
    expect(formatUpdateAge(barelyAhead, NOW)).toBe('30 seconds ago');
  });

  it('returns null for an unusable value', () => {
    expect(formatUpdateAge(null, NOW)).toBeNull();
    expect(formatUpdateAge('nonsense', NOW)).toBeNull();
  });
});

describe('shortUpdateId', () => {
  it('takes the first eight characters', () => {
    expect(shortUpdateId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4',
    );
  });

  it.each([null, undefined, '', '   ', 42])('returns null for %p', (value) => {
    expect(shortUpdateId(value)).toBeNull();
  });
});

describe('describeRunningUpdate', () => {
  const OTA = {
    updateId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    createdAt: PUBLISHED,
    channel: 'production',
    runtimeVersion: '1.2.0',
    isEmbeddedLaunch: false,
    isEnabled: true,
    now: NOW,
  };

  it('leads with the publish date for an applied update', () => {
    const d = describeRunningUpdate(OTA);

    expect(d.source).toBe(UPDATE_SOURCE.OTA);
    expect(d.label).toBe('1 Sep 2026, 09:30 AM');
    expect(d.detail).toBe('3 days ago · ID a1b2c3d4 · production');
    expect(d.runtimeVersion).toBe('1.2.0');
  });

  /**
   * The important one. A device that has taken no OTA still reports a
   * `createdAt` — the binary's own manifest time — so leading with that date
   * would show a confident timestamp for an update that never happened, and
   * "have you got the fix?" would be answered wrongly.
   */
  it('says so plainly when no update has been applied', () => {
    const d = describeRunningUpdate({ ...OTA, isEmbeddedLaunch: true });

    expect(d.source).toBe(UPDATE_SOURCE.EMBEDDED);
    expect(d.label).toBe('Original build');
    expect(d.detail).toBe('Built 1 Sep 2026, 09:30 AM');
    // The date is still available to a caller that wants it, just not as the
    // headline.
    expect(d.publishedAt).toBe('1 Sep 2026, 09:30 AM');
  });

  it('treats a missing update id as the original build', () => {
    const d = describeRunningUpdate({ ...OTA, updateId: null });

    expect(d.source).toBe(UPDATE_SOURCE.EMBEDDED);
    expect(d.label).toBe('Original build');
  });

  it('reports a development build rather than inventing an identity', () => {
    const d = describeRunningUpdate({
      updateId: null,
      createdAt: null,
      channel: '',
      runtimeVersion: null,
      isEnabled: false,
      now: NOW,
    });

    expect(d.source).toBe(UPDATE_SOURCE.DEVELOPMENT);
    expect(d.label).toBe('Development build');
    expect(d.channel).toBeNull();
    expect(d.runtimeVersion).toBe('unknown');
  });

  it('still names the update when the date is unusable', () => {
    const d = describeRunningUpdate({ ...OTA, createdAt: null });

    expect(d.label).toBe('Applied');
    expect(d.detail).toBe('ID a1b2c3d4 · production');
  });

  it('survives being called with nothing at all', () => {
    expect(() => describeRunningUpdate()).not.toThrow();
    expect(describeRunningUpdate().source).toBe(UPDATE_SOURCE.EMBEDDED);
  });
});

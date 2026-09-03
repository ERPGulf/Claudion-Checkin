import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

let mockModernUi = true;
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: mockModernUi, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub };
});

jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// The hook has its own subscriptions and is exercised separately; this suite is
// about what the pill renders for a given status.
let mockStatus = {
  visible: false,
  phase: 'hidden',
  pendingCount: 0,
  content: null,
  actionable: false,
  loadUnresolvedRows: async () => [],
};
jest.mock('../hooks/useOfflineStatus', () => ({
  __esModule: true,
  default: () => mockStatus,
}));

/* eslint-disable import/first */
import AttendanceSyncSheet from '../components/common/AttendanceSyncSheet';
import OfflineBanner from '../components/common/OfflineBanner';
import { COLORS, DARK_COLORS } from '../constants';
import {
  OFFLINE_PHASE,
  describeOfflineStatus,
} from '../utils/offlineStatus';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

const showPhase = (phase, counts = {}) => {
  const content = describeOfflineStatus(phase, counts);
  mockStatus = {
    visible: true,
    phase,
    ...counts,
    content,
    actionable: !!content?.actionable,
    loadUnresolvedRows: async () => [],
  };
};

const hide = () => {
  mockStatus = {
    visible: false,
    phase: 'hidden',
    pendingCount: 0,
    content: null,
    actionable: false,
    loadUnresolvedRows: async () => [],
  };
};

beforeEach(() => {
  mockScheme = 'light';
  mockModernUi = true;
  hide();
});

describe('visibility', () => {
  it('renders nothing at all when there is nothing to say', () => {
    const { toJSON } = render(<OfflineBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders the pill when offline', () => {
    showPhase(OFFLINE_PHASE.OFFLINE);
    const { getByText } = render(<OfflineBanner />);

    expect(getByText("You're offline")).toBeTruthy();
    expect(
      getByText("Attendance will sync automatically when you're back online."),
    ).toBeTruthy();
  });
});

describe('content per phase', () => {
  it('reports the queue depth', () => {
    showPhase(OFFLINE_PHASE.OFFLINE, { pending: 3 });
    const { getByText } = render(<OfflineBanner />);

    expect(getByText('3 attendance records waiting to sync')).toBeTruthy();
  });

  it('shows a spinning sync glyph while syncing', () => {
    showPhase(OFFLINE_PHASE.SYNCING);
    const { getByText } = render(<OfflineBanner />);

    expect(getByText('Syncing attendance…')).toBeTruthy();
    expect(getByText('icon:sync-outline')).toBeTruthy();
  });

  it('shows a green check when everything has landed', () => {
    showPhase(OFFLINE_PHASE.SYNCED);
    const { getByText, queryByText } = render(<OfflineBanner />);

    expect(getByText('All attendance synced')).toBeTruthy();
    expect(getByText('icon:checkmark-circle')).toBeTruthy();
    // Nothing left to animate once it is done.
    expect(queryByText('icon:sync-outline')).toBeNull();
  });
});

describe('appearance', () => {
  const pillStyle = tree => {
    // host View (box-none) → Animated pill
    const host = tree.toJSON();
    return flatten(host.children[0].props.style);
  };

  it('uses the warning triad offline — amber, not an error red', () => {
    showPhase(OFFLINE_PHASE.OFFLINE);
    const style = pillStyle(render(<OfflineBanner />));

    expect(style.backgroundColor).toBe(COLORS.warningSurface);
    expect(style.borderColor).toBe(COLORS.warningBorder);
    expect(style.backgroundColor).not.toBe(COLORS.errorSurface);
  });

  it('uses the success triad once synced', () => {
    showPhase(OFFLINE_PHASE.SYNCED);
    const style = pillStyle(render(<OfflineBanner />));

    expect(style.backgroundColor).toBe(COLORS.successSurface);
  });

  it('takes its colours from the dark palette in dark mode', () => {
    mockScheme = 'dark';
    showPhase(OFFLINE_PHASE.OFFLINE);
    const style = pillStyle(render(<OfflineBanner />));

    expect(style.backgroundColor).toBe(DARK_COLORS.warningSurface);
  });

  // A shadow on a dark surface is invisible; the border does the separating.
  it('drops the shadow in dark mode', () => {
    mockScheme = 'dark';
    showPhase(OFFLINE_PHASE.OFFLINE);
    const style = pillStyle(render(<OfflineBanner />));

    expect(style.shadowOpacity).toBeUndefined();
  });

  it('stays compact', () => {
    showPhase(OFFLINE_PHASE.OFFLINE, { pending: 3 });
    const style = pillStyle(render(<OfflineBanner />));

    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeLessThanOrEqual(56);
  });

  // Anchored to the bottom rather than the top, and deliberately so: measured on
  // an iPhone 17 simulator, the top placement sat straight on the employee's
  // name in the Home welcome card, because the tab screens have no header and
  // their content starts immediately under the safe area.
  it('sits above the tab bar, clearing the bottom safe-area inset', () => {
    showPhase(OFFLINE_PHASE.OFFLINE);
    const host = render(<OfflineBanner />).toJSON();
    const style = flatten(host.props.style);

    // inset.bottom (34) + tab bar content (48) + gap (12)
    expect(style.bottom).toBe(94);
    expect(style.top).toBeUndefined();
  });
});

describe('it never gets in the way', () => {
  it('lets touches through to the screen underneath', () => {
    showPhase(OFFLINE_PHASE.OFFLINE);
    const host = render(<OfflineBanner />).toJSON();

    expect(host.props.pointerEvents).toBe('box-none');
    expect(host.children[0].props.pointerEvents).toBe('none');
  });

  it('announces itself politely rather than stealing focus', () => {
    showPhase(OFFLINE_PHASE.OFFLINE, { pending: 2 });
    const host = render(<OfflineBanner />).toJSON();
    const pill = host.children[0].props;

    expect(pill.accessibilityLiveRegion).toBe('polite');
    expect(pill.accessibilityLabel).toBe(
      "You're offline. 2 attendance records waiting to sync",
    );
  });
});

describe('exit animation', () => {
  // Unmounting on the state change would cut the fade off at frame one.
  it('keeps the pill mounted while it fades out', () => {
    showPhase(OFFLINE_PHASE.OFFLINE);
    const { queryByText, rerender } = render(<OfflineBanner />);
    expect(queryByText("You're offline")).toBeTruthy();

    hide();
    act(() => {
      rerender(<OfflineBanner />);
    });

    // Still on screen — the words survive the transition rather than blanking.
    expect(queryByText("You're offline")).toBeTruthy();
  });
});

/**
 * The state that used to render nothing.
 *
 * A pending punch outlives the offline banner — the phone comes back onto wifi —
 * and never reaches the administrator banner, because nothing is blocked. Six of
 * them sat on a production device for a day with the app saying nothing at all.
 */
describe('the waiting pill', () => {
  it('says the records are still waiting, and invites a tap', () => {
    showPhase(OFFLINE_PHASE.WAITING, { pendingCount: 6, pending: 6 });
    const { getByText } = render(<OfflineBanner />);

    expect(getByText('Attendance still waiting to sync')).toBeTruthy();
    expect(
      getByText('6 attendance records saved on your device. Tap for details.'),
    ).toBeTruthy();
  });

  // Amber. Nothing is lost and the employee has done nothing wrong.
  it('is a warning, not an error', () => {
    showPhase(OFFLINE_PHASE.WAITING, { pendingCount: 1, pending: 1 });
    const { getByText } = render(<OfflineBanner />);

    expect(getByText('icon:cloud-upload-outline')).toBeTruthy();
  });
});

/**
 * The support line on the sheet.
 *
 * Diagnosing a stuck queue used to need a debugger attached to the employee's
 * phone: nothing they could see distinguished "retried forty times" from "never
 * attempted once". This is the line they can screenshot.
 */
describe('the sync sheet support line', () => {
  const pendingRow = {
    id: 12,
    action: 'checkin',
    timestamp: '2026-09-02 05:13:00',
    status: 'pending',
    retryCount: 3,
    nextAttemptAt: 0,
    error: 'frappe.exceptions.ValidationError: something internal',
  };

  it('shows the row id, its state and its attempts', () => {
    const { getByText } = render(
      <AttendanceSyncSheet visible rows={[pendingRow]} onClose={() => {}} />,
    );

    expect(getByText('#12 · pending · 3 attempts · due now')).toBeTruthy();
  });

  it('keeps the employee-facing explanation free of it', () => {
    const { getByText } = render(
      <AttendanceSyncSheet visible rows={[pendingRow]} onClose={() => {}} />,
    );

    expect(getByText('Pending sync')).toBeTruthy();
    expect(getByText('Saved on your device, waiting to be sent.')).toBeTruthy();
  });

  it('never shows the server exception text', () => {
    const { queryByText } = render(
      <AttendanceSyncSheet visible rows={[pendingRow]} onClose={() => {}} />,
    );

    expect(queryByText(/frappe|ValidationError/)).toBeNull();
  });

  it('says nothing about a next attempt for a row that will never be retried', () => {
    const { getByText } = render(
      <AttendanceSyncSheet
        visible
        onClose={() => {}}
        rows={[
          {
            ...pendingRow,
            id: 7,
            status: 'rejected',
            failureClass: 'validation',
            retryCount: 2,
          },
        ]}
      />,
    );

    expect(getByText('#7 · rejected/validation · 2 attempts')).toBeTruthy();
  });
});

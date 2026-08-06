import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text: RNText } = require('react-native');
  const stub = ({ name }) => <RNText>{`icon:${name}`}</RNText>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

/* ---------------------------------------------------------------------------
 * useExpenseClaims is exercised through a probe component rather than
 * renderHook, so the pagination guard is tested the way the list uses it — a
 * burst of presses inside one act(), which is what a burst of `onEndReached`
 * events looks like to React.
 *
 * Everything below the hook is stubbed: the query and the mutation are the parts
 * this change explicitly must not touch.
 * ------------------------------------------------------------------------ */

const mockQueryState = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  isRefetching: false,
};

const mockRefetch = jest.fn(() => Promise.resolve());

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ ...mockQueryState, refetch: mockRefetch }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('react-redux', () => ({
  useSelector: () => 'EMP-001',
}));

// services/api re-exports the attendance service, which pulls in expo-location —
// untransformed under this jest config. The query is stubbed anyway.
jest.mock('../services/api', () => ({
  getExpenseClaims: jest.fn(),
  createExpenseClaim: jest.fn(),
  uploadExpenseAttachment: jest.fn(),
}));

/* eslint-disable import/first */
import useExpenseClaims, { PAGE_SIZE } from '../hooks/useExpenseClaims';
import HistoryFooter from '../components/ExpenseClaim/HistoryFooter';
import AppearingItem from '../components/ExpenseClaim/AppearingItem';
/* eslint-enable import/first */

function claimsFixture(n, overrides = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    name: `HR-EXP-${i}`,
    expense_date: '2026-08-05',
    amount: 100 + i,
    ...overrides(i),
  }));
}

/** Surfaces the hook's pagination state and hands back its callbacks. */
function Probe({ onReady }) {
  const state = useExpenseClaims();
  onReady(state);

  return (
    <Text>{`${state.visibleClaims.length}/${state.claims.length}:${
      state.hasMore ? 'more' : 'end'
    }`}</Text>
  );
}

/**
 * Mounts inside `act` and flushes microtasks, because the hook reads the tenant
 * `baseUrl` out of AsyncStorage on mount — that promise resolves after the
 * render and would otherwise set state outside `act`.
 */
async function mountProbe() {
  const ref = { current: null };
  const view = render(<Probe onReady={s => { ref.current = s; }} />);

  // Flush the AsyncStorage read. Spreading `view` is deliberately avoided —
  // its `root` is a getter that throws once the renderer is torn down.
  await act(async () => {});

  view.hook = ref;
  return view;
}

describe('useExpenseClaims pagination', () => {
  beforeEach(() => {
    mockQueryState.data = claimsFixture(12);
    mockQueryState.isError = false;
    mockQueryState.isRefetching = false;
    mockRefetch.mockClear();
  });

  it('starts on one page and reports there is more', async () => {
    const { getByText } = await mountProbe();
    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();
  });

  it('reveals exactly one page per call', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.loadMore());
    expect(getByText(`${PAGE_SIZE * 2}/12:more`)).toBeTruthy();
  });

  it('advances one page for a burst of end-of-list events, not several', async () => {
    const { getByText, hook } = await mountProbe();

    // What a fast scroll actually does: onEndReached fires repeatedly before
    // React has committed the first increment. Without the guard this would
    // skip straight past page two.
    act(() => {
      hook.current.loadMore();
      hook.current.loadMore();
      hook.current.loadMore();
    });

    expect(getByText(`${PAGE_SIZE * 2}/12:more`)).toBeTruthy();
  });

  it('keeps paging after the guard releases', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.loadMore());
    act(() => hook.current.loadMore());

    // Page three would be rows 11–15, but there are only 12 claims — the slice
    // clamps, so the last page is short rather than padded.
    expect(getByText('12/12:end')).toBeTruthy();
  });

  it('stops at the end and never overshoots the data', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.loadMore());
    act(() => hook.current.loadMore());
    // The list keeps firing onEndReached while the user sits at the bottom.
    act(() => hook.current.loadMore());
    act(() => hook.current.loadMore());

    expect(getByText('12/12:end')).toBeTruthy();
  });

  it('reports the end immediately when everything fits on one page', async () => {
    mockQueryState.data = claimsFixture(3);
    const { getByText } = await mountProbe();

    expect(getByText('3/3:end')).toBeTruthy();
  });

  it('refresh goes back to page one and refetches', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.loadMore());
    expect(getByText(`${PAGE_SIZE * 2}/12:more`)).toBeTruthy();

    await act(async () => {
      await hook.current.refresh();
    });

    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('can page again after a refresh', async () => {
    const { getByText, hook } = await mountProbe();

    await act(async () => {
      await hook.current.refresh();
    });
    act(() => hook.current.loadMore());

    expect(getByText(`${PAGE_SIZE * 2}/12:more`)).toBeTruthy();
  });
});

describe('useExpenseClaims search', () => {
  beforeEach(() => {
    // 8 Travel, 4 Medical.
    mockQueryState.data = claimsFixture(12, i => ({
      expense_type: i < 8 ? 'Travel' : 'Medical',
    }));
    mockRefetch.mockClear();
  });

  it('is inert until a query is set — which is what the classic screen sees', async () => {
    const { getByText, hook } = await mountProbe();

    expect(hook.current.isSearching).toBe(false);
    expect(hook.current.filteredClaims).toHaveLength(12);
    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();
  });

  it('searches the whole set, not just the page on screen', async () => {
    const { getByText, hook } = await mountProbe();

    // Medical claims are all at index 8+, well past the first page of five.
    // Filtering the slice instead of the source would find none of them.
    act(() => hook.current.setSearchQuery('medical'));

    expect(hook.current.filteredClaims).toHaveLength(4);
    expect(getByText('4/12:end')).toBeTruthy();
  });

  it('paginates the matches when a query has more than one page of them', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.setSearchQuery('travel'));
    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();

    act(() => hook.current.loadMore());
    expect(getByText('8/12:end')).toBeTruthy();
  });

  it('restarts at page one for a new query', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.loadMore());
    act(() => hook.current.loadMore());

    act(() => hook.current.setSearchQuery('travel'));

    // Without the reset this would drop all eight matches in at once, having
    // inherited a cursor from a scroll the user made against a different list.
    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();
  });

  it('goes back to the full list, page one, when the query is cleared', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.setSearchQuery('medical'));
    act(() => hook.current.setSearchQuery(''));

    expect(hook.current.isSearching).toBe(false);
    expect(getByText(`${PAGE_SIZE}/12:more`)).toBeTruthy();
  });

  it('reports no matches without claiming the history is empty', async () => {
    const { getByText, hook } = await mountProbe();

    act(() => hook.current.setSearchQuery('zzzz'));

    expect(getByText('0/12:end')).toBeTruthy();
    // The distinction the empty state depends on: nothing matched, but there
    // are still twelve claims.
    expect(hook.current.claims).toHaveLength(12);
    expect(hook.current.isSearching).toBe(true);
  });

  it('treats a whitespace-only query as no query at all', async () => {
    const { hook } = await mountProbe();

    act(() => hook.current.setSearchQuery('   '));

    expect(hook.current.isSearching).toBe(false);
    expect(hook.current.filteredClaims).toHaveLength(12);
  });
});

describe('HistoryFooter', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows placeholder cards while there is another page to reveal', () => {
    const { getByLabelText, queryByText } = render(
      <HistoryFooter hasMore isEmpty={false} showRetry={false} onRetry={jest.fn()} />,
    );

    expect(getByLabelText('Loading more expenses')).toBeTruthy();
    expect(queryByText("You've reached the end")).toBeNull();
  });

  it('drops the loader entirely at the end of the list', () => {
    const { getByText, queryByLabelText } = render(
      <HistoryFooter hasMore={false} isEmpty={false} showRetry={false} onRetry={jest.fn()} />,
    );

    expect(queryByLabelText('Loading more expenses')).toBeNull();
    expect(getByText("You've reached the end")).toBeTruthy();
  });

  it('says nothing under an empty list — the empty state is already speaking', () => {
    const { toJSON } = render(
      <HistoryFooter hasMore={false} isEmpty showRetry={false} onRetry={jest.fn()} />,
    );

    expect(toJSON()).toBeNull();
  });

  it('offers a compact retry row instead of taking over the screen', () => {
    const onRetry = jest.fn();
    const { getByText, getByLabelText, queryByText } = render(
      <HistoryFooter hasMore isEmpty={false} showRetry onRetry={onRetry} />,
    );

    expect(getByText("Couldn't load more expenses.")).toBeTruthy();
    // The retry row wins over the loader — showing both would claim it is
    // simultaneously loading and failed.
    expect(queryByText("You've reached the end")).toBeNull();

    fireEvent.press(getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AppearingItem', () => {
  it('animates a row the first time it is seen', () => {
    const seen = new Set();
    const { UNSAFE_getAllByType } = render(
      <AppearingItem itemKey="a" seen={seen}>
        <Text>row</Text>
      </AppearingItem>,
    );

    const { Animated } = require('react-native');
    expect(UNSAFE_getAllByType(Animated.View).length).toBe(1);
  });

  it('renders a row it has already shown at rest, with no animated node', () => {
    const seen = new Set(['a']);
    const { UNSAFE_queryAllByType, getByText } = render(
      <AppearingItem itemKey="a" seen={seen}>
        <Text>row</Text>
      </AppearingItem>,
    );

    const { Animated } = require('react-native');
    expect(getByText('row')).toBeTruthy();
    // The flashing this prevents: a card scrolled out of the window and back
    // must not replay its entrance.
    expect(UNSAFE_queryAllByType(Animated.View).length).toBe(0);
  });

  it('records a row on mount, so remounting it is silent', () => {
    const seen = new Set();

    render(
      <AppearingItem itemKey="a" seen={seen}>
        <Text>row</Text>
      </AppearingItem>,
    );

    expect(seen.has('a')).toBe(true);

    const { UNSAFE_queryAllByType } = render(
      <AppearingItem itemKey="a" seen={seen}>
        <Text>row</Text>
      </AppearingItem>,
    );

    const { Animated } = require('react-native');
    expect(UNSAFE_queryAllByType(Animated.View).length).toBe(0);
  });

  it('still animates a genuinely new row alongside remembered ones', () => {
    const seen = new Set(['a', 'b']);
    const { UNSAFE_getAllByType } = render(
      <AppearingItem itemKey="c" seen={seen}>
        <Text>row</Text>
      </AppearingItem>,
    );

    const { Animated } = require('react-native');
    expect(UNSAFE_getAllByType(Animated.View).length).toBe(1);
  });
});

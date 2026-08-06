import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

/* eslint-disable import/first */
import { claimMatchesQuery, claimSearchIndex } from '../utils/expenseClaims';
import SearchBar, { SearchCount } from '../components/common/SearchBar';
import AttachmentSheet from '../components/common/AttachmentSheet';
import BottomSheet from '../components/common/BottomSheet';
import HistorySectionHeader from '../components/ExpenseClaim/HistorySectionHeader';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

function flatten(style) {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) || {};
}

/**
 * Every resolved style in a subtree.
 *
 * These components put their geometry in `style`, not in props, so
 * `findByProps({ borderWidth: 1 })` finds nothing — this walks the host nodes
 * and flattens each one instead. Returning styles rather than nodes keeps the
 * assertions about what a thing looks like rather than where it sits in the
 * tree, which is what makes them survive a wrapper being added.
 */
function stylesIn(node) {
  return node
    .findAll(child => typeof child.type === 'string' && !!child.props?.style, {
      deep: true,
    })
    .map(child => flatten(child.props.style));
}

/** The first style in `node`'s subtree matching `predicate`. */
function styleWhere(node, predicate) {
  const found = stylesIn(node).find(predicate);
  if (!found) throw new Error('no style in the subtree matched');
  return found;
}

const CLAIM = {
  name: 'HR-EXP-2026-00042',
  expense_type: 'travel',
  expense_date: '2026-08-05',
  amount: 1250,
  description: 'Airport transfer to the client site',
  status: 'Approved',
  file_url: '/files/taxi-receipt.pdf',
};

/* =====================================================================
 * Search matching
 * ================================================================== */

describe('claimMatchesQuery', () => {
  it('matches everything when the query is empty — the classic screen never sets one', () => {
    expect(claimMatchesQuery(CLAIM, '')).toBe(true);
    expect(claimMatchesQuery(CLAIM, '   ')).toBe(true);
    expect(claimMatchesQuery(CLAIM, undefined)).toBe(true);
  });

  it('finds a claim by its expense type', () => {
    expect(claimMatchesQuery(CLAIM, 'travel')).toBe(true);
    expect(claimMatchesQuery(CLAIM, 'Travel')).toBe(true);
    expect(claimMatchesQuery(CLAIM, 'trav')).toBe(true);
  });

  it('finds a claim by words in its description', () => {
    expect(claimMatchesQuery(CLAIM, 'airport')).toBe(true);
    expect(claimMatchesQuery(CLAIM, 'client site')).toBe(true);
  });

  it('finds a claim by the amount as stored and as displayed', () => {
    expect(claimMatchesQuery(CLAIM, '1250')).toBe(true);
    // What the card actually shows — a user searching for what they can see.
    expect(claimMatchesQuery(CLAIM, '1,250')).toBe(true);
    expect(claimMatchesQuery(CLAIM, '1,250.00')).toBe(true);
  });

  it('finds a claim by the date as stored and as displayed', () => {
    expect(claimMatchesQuery(CLAIM, '2026-08-05')).toBe(true);
    // The card renders "5 Aug 2026", so "aug" has to work.
    expect(claimMatchesQuery(CLAIM, 'aug')).toBe(true);
    expect(claimMatchesQuery(CLAIM, '5 Aug 2026')).toBe(true);
  });

  it('finds a claim by its status', () => {
    expect(claimMatchesQuery(CLAIM, 'approved')).toBe(true);
    expect(claimMatchesQuery(CLAIM, 'reject')).toBe(false);
  });

  it('finds a claim by its receipt filename', () => {
    expect(claimMatchesQuery(CLAIM, 'taxi')).toBe(true);
    expect(claimMatchesQuery(CLAIM, 'receipt.pdf')).toBe(true);
  });

  it('resolves a filename without a tenant URL, so search works before it loads', () => {
    expect(claimMatchesQuery(CLAIM, 'taxi', '')).toBe(true);
  });

  it('requires every term, so a second word narrows rather than widens', () => {
    expect(claimMatchesQuery(CLAIM, 'travel approved')).toBe(true);
    // "medical" is nowhere on this claim — AND semantics must reject it even
    // though "travel" matches.
    expect(claimMatchesQuery(CLAIM, 'travel medical')).toBe(false);
  });

  it('returns false for a term that appears nowhere', () => {
    expect(claimMatchesQuery(CLAIM, 'zzzz')).toBe(false);
  });

  it('survives a claim with almost no fields', () => {
    expect(claimMatchesQuery({ name: 'X' }, 'x')).toBe(true);
    expect(claimMatchesQuery({ name: 'X' }, 'travel')).toBe(false);
    expect(claimMatchesQuery(null, 'travel')).toBe(false);
  });

  it('indexes only strings, so a null field cannot crash the filter', () => {
    const index = claimSearchIndex({
      expense_type: null,
      amount: null,
      description: undefined,
    });

    expect(index.every(value => typeof value === 'string')).toBe(true);
  });
});

/* =====================================================================
 * SearchBar
 * ================================================================== */

describe('SearchBar', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('reports every keystroke, so filtering is instant', () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <SearchBar value="" onChangeText={onChangeText} accessibilityLabel="Search claims" />,
    );

    fireEvent.changeText(getByLabelText('Search claims'), 'trav');
    expect(onChangeText).toHaveBeenCalledWith('trav');
  });

  it('asks the keyboard for a Search action key', () => {
    const { getByLabelText } = render(
      <SearchBar value="" onChangeText={jest.fn()} accessibilityLabel="Search claims" />,
    );

    expect(getByLabelText('Search claims').props.returnKeyType).toBe('search');
  });

  it('hides the clear button until there is something to clear', () => {
    const empty = render(<SearchBar value="" onChangeText={jest.fn()} />);
    expect(empty.queryByLabelText('Clear search')).toBeNull();

    const filled = render(<SearchBar value="taxi" onChangeText={jest.fn()} />);
    expect(filled.getByLabelText('Clear search')).toBeTruthy();
  });

  it('empties the query when cleared', () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <SearchBar value="taxi" onChangeText={onChangeText} />,
    );

    fireEvent.press(getByLabelText('Clear search'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('reads focus the same way the form fields do', () => {
    const { getByLabelText, UNSAFE_root } = render(
      <SearchBar value="" onChangeText={jest.fn()} accessibilityLabel="Search claims" />,
    );

    const input = getByLabelText('Search claims');
    const box = () => styleWhere(UNSAFE_root, style => style.borderWidth === 1);

    expect(box().backgroundColor).toBe(COLORS.surfaceSecondary);

    fireEvent(input, 'focus');
    expect(box().backgroundColor).toBe(COLORS.cardBackground);
    expect(box().borderColor).toBe(COLORS.textPrimary);
  });

  it('takes its colours from the dark palette when the theme is dark', () => {
    mockScheme = 'dark';
    const { UNSAFE_root } = render(<SearchBar value="" onChangeText={jest.fn()} />);

    const box = styleWhere(UNSAFE_root, style => style.borderWidth === 1);
    expect(box.backgroundColor).toBe(DARK_COLORS.surfaceSecondary);
  });
});

describe('SearchCount', () => {
  it('reads as a total when nothing is filtered out', () => {
    const { getByText } = render(<SearchCount matches={42} total={42} />);
    expect(getByText('42 claims')).toBeTruthy();
  });

  it('reads as a tally while a query is narrowing the list', () => {
    const { getByText } = render(<SearchCount matches={3} total={42} />);
    expect(getByText('3 of 42')).toBeTruthy();
  });

  it('does not pluralise a single claim', () => {
    const { getByText } = render(<SearchCount matches={1} total={1} />);
    expect(getByText('1 claim')).toBeTruthy();
  });
});

/* =====================================================================
 * HistorySectionHeader
 * ================================================================== */

describe('HistorySectionHeader', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows the heading, the count and the search bar', () => {
    const { getByText, getByLabelText } = render(
      <HistorySectionHeader
        total={42}
        matches={42}
        searchQuery=""
        onChangeSearch={jest.fn()}
      />,
    );

    expect(getByText('History')).toBeTruthy();
    expect(getByText('42 claims')).toBeTruthy();
    expect(getByLabelText('Search expense claims')).toBeTruthy();
  });

  it('offers no search bar when there is no history to search', () => {
    const { queryByLabelText, getByText } = render(
      <HistorySectionHeader
        total={0}
        matches={0}
        searchQuery=""
        onChangeSearch={jest.fn()}
      />,
    );

    expect(getByText('History')).toBeTruthy();
    expect(queryByLabelText('Search expense claims')).toBeNull();
  });

  it('is opaque and full-bleed, so cards cannot show through it while it is stuck', () => {
    const { UNSAFE_root } = render(
      <HistorySectionHeader total={5} matches={5} searchQuery="" onChangeSearch={jest.fn()} />,
    );

    // The page gutter is applied here rather than on the list's content
    // container, precisely so the sticky background reaches both edges.
    const header = styleWhere(
      UNSAFE_root,
      style => style.backgroundColor === COLORS.surfaceSecondary,
    );

    expect(header.paddingHorizontal).toBe(16);
  });
});

/* =====================================================================
 * AttachmentSheet
 * ================================================================== */

describe('AttachmentSheet', () => {
  const handlers = () => ({
    onClose: jest.fn(),
    onSelectCamera: jest.fn(),
    onSelectGallery: jest.fn(),
    onSelectDocument: jest.fn(),
  });

  beforeEach(() => {
    mockScheme = 'light';
  });

  it('has a header with a title and a subtitle', () => {
    const { getByText } = render(<AttachmentSheet visible {...handlers()} />);

    expect(getByText('Add Attachment')).toBeTruthy();
    expect(getByText('Choose how you want to attach a receipt.')).toBeTruthy();
  });

  it('offers all three options with a title and a subtitle each', () => {
    const { getByText } = render(<AttachmentSheet visible {...handlers()} />);

    expect(getByText('Take Photo')).toBeTruthy();
    expect(getByText('Capture a new receipt')).toBeTruthy();
    expect(getByText('Choose Image')).toBeTruthy();
    expect(getByText('Select from your gallery')).toBeTruthy();
    expect(getByText('Browse Files')).toBeTruthy();
    expect(getByText('PDF, JPG, PNG')).toBeTruthy();
  });

  it('forwards each option to its picker unchanged', () => {
    const props = handlers();
    const { getByLabelText } = render(<AttachmentSheet visible {...props} />);

    fireEvent.press(getByLabelText('Take Photo. Capture a new receipt'));
    fireEvent.press(getByLabelText('Choose Image. Select from your gallery'));
    fireEvent.press(getByLabelText('Browse Files. PDF, JPG, PNG'));

    expect(props.onSelectCamera).toHaveBeenCalledTimes(1);
    expect(props.onSelectGallery).toHaveBeenCalledTimes(1);
    expect(props.onSelectDocument).toHaveBeenCalledTimes(1);
  });

  it('closes from the header button, with no Cancel button at the bottom', () => {
    const props = handlers();
    const { getByLabelText, queryByText } = render(
      <AttachmentSheet visible {...props} />,
    );

    expect(queryByText('Cancel')).toBeNull();

    fireEvent.press(getByLabelText('Close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the backdrop', () => {
    const props = handlers();
    const { getByLabelText } = render(<AttachmentSheet visible {...props} />);

    fireEvent.press(getByLabelText('Close Add Attachment'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('gives each option a chevron and a large touch target', () => {
    const { getByLabelText, getAllByText } = render(
      <AttachmentSheet visible {...handlers()} />,
    );

    const row = getByLabelText('Take Photo. Capture a new receipt');
    const target = styleWhere(row, style => !!style.minHeight);

    expect(target.minHeight).toBeGreaterThanOrEqual(44);
    expect(getAllByText('icon:chevron-forward').length).toBe(3);
  });

  it('uses no colourful icon backgrounds — the chip is the app-wide neutral', () => {
    const { UNSAFE_root } = render(<AttachmentSheet visible {...handlers()} />);

    const chips = stylesIn(UNSAFE_root)
      .filter(style => style.width === 44 && style.height === 44)
      .map(style => style.backgroundColor)
      .filter(Boolean);

    expect(chips.length).toBeGreaterThan(0);
    // The old sheet had #E0F2FE / #DCFCE7 / #FEF3C7 circles here.
    chips.forEach(color => expect(color).toBe(COLORS.iconBackground));
  });
});

/* =====================================================================
 * BottomSheet
 * ================================================================== */

describe('BottomSheet', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('renders nothing at all while closed', () => {
    const { toJSON } = render(
      <BottomSheet visible={false} onClose={jest.fn()} title="Sheet" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('surfaces its body once open', () => {
    const { getByText } = render(
      <BottomSheet visible onClose={jest.fn()} title="Sheet" subtitle="Sub">
        <Text>body</Text>
      </BottomSheet>,
    );

    expect(getByText('Sheet')).toBeTruthy();
    expect(getByText('Sub')).toBeTruthy();
    expect(getByText('body')).toBeTruthy();
  });

  it('advertises the swipe-down gesture to screen readers', () => {
    const { getByLabelText } = render(
      <BottomSheet visible onClose={jest.fn()} title="Sheet" />,
    );

    expect(getByLabelText('Swipe down to dismiss')).toBeTruthy();
  });

  it('takes its panel colour from the palette, never a hardcoded white', () => {
    const panelOf = view =>
      styleWhere(view.UNSAFE_root, style => !!style.borderTopStartRadius);

    const light = render(<BottomSheet visible onClose={jest.fn()} title="Sheet" />);
    expect(panelOf(light).backgroundColor).toBe(COLORS.cardBackground);

    mockScheme = 'dark';
    const dark = render(<BottomSheet visible onClose={jest.fn()} title="Sheet" />);
    expect(panelOf(dark).backgroundColor).toBe(DARK_COLORS.cardBackground);
    expect(panelOf(dark).backgroundColor).not.toBe('#FFFFFF');
  });

  it('clears the home indicator with the safe-area inset', () => {
    const { UNSAFE_root } = render(
      <BottomSheet visible onClose={jest.fn()} title="Sheet" />,
    );

    const panel = styleWhere(UNSAFE_root, style => !!style.borderTopStartRadius);
    expect(panel.paddingBottom).toBe(34);
  });
});

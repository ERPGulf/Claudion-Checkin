/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import SearchBar, { SearchCount } from '../common/SearchBar';

/**
 * The "History" heading and its search bar — the list's sticky section header.
 *
 * Sticky is the reason this is a section header rather than part of the list
 * header: `stickyHeaderIndices` on a FlatList would pin the *entire*
 * `ListHeaderComponent`, which here is the whole create-claim form. A
 * SectionList pins only this, so the form scrolls away and the search bar stays.
 *
 * Which is also why the background is opaque and runs the full width, with the
 * page's own horizontal inset applied here instead of on the list: a
 * transparent sticky header would have claim cards sliding visibly underneath
 * the search field.
 *
 * The count reads "42 claims" normally and "3 of 42" while a query is active, so
 * the heading answers "did my search do anything" without the user scrolling to
 * find out.
 */
function HistorySectionHeader({ total, matches, searchQuery, onChangeSearch }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        backgroundColor: colors.surfaceSecondary,
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.xxl,
        paddingBottom: SPACING.md,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: SPACING.sm,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ ...TYPO.title3, color: colors.textPrimary, flex: 1 }}
        >
          History
        </Text>

        {total > 0 && (
          <SearchCount
            matches={matches}
            total={total}
            style={{ marginStart: SPACING.sm }}
          />
        )}
      </View>

      {/* Hidden until there is something to search. A search bar over an empty
          history is a control that can only ever return nothing. */}
      {total > 0 && (
        <SearchBar
          value={searchQuery}
          onChangeText={onChangeSearch}
          placeholder="Search expenses…"
          accessibilityLabel="Search expense claims"
        />
      )}
    </View>
  );
}

export default HistorySectionHeader;

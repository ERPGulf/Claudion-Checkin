import React, { useCallback, useMemo, useRef } from "react";
import { Platform, RefreshControl, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SPACING } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useExpenseClaims from "../hooks/useExpenseClaims";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import StatusBanner from "../components/common/StatusBanner";
import {
  AppearingItem,
  ClaimFormSection,
  ExpenseHistoryCard,
  ExpenseSkeleton,
  HistoryFooter,
  HistorySectionHeader,
} from "../components/ExpenseClaim";

/**
 * Gap between claim cards, and the page gutter.
 *
 * A module constant rather than an inline object, so the memoised
 * <ExpenseHistoryCard> gets the same style reference every render and its
 * shallow prop comparison actually holds. The horizontal inset lives here rather
 * than on `contentContainerStyle` because the sticky section header has to run
 * full-width — an inset content container would leave a transparent margin for
 * cards to slide through.
 */
const CARD_STYLE = {
  marginBottom: SPACING.md,
  marginHorizontal: SPACING.lg,
};

const LIST_CONTENT = {
  paddingTop: SPACING.lg,
  paddingBottom: SPACING.xxxl,
};

/** Same gutter, for the blocks that aren't cards. */
const GUTTER = { paddingHorizontal: SPACING.lg };

/**
 * Modern Expense Claims.
 *
 * Presentation only. The history query, the create mutation, the attachment
 * upload, the page cursor and the search filter live in
 * hooks/useExpenseClaims.js; every form field and `handleSubmit` live in
 * hooks/useExpenseClaimForm.js. Both are shared with ExpenseClaimLegacy, so
 * validation, the payload and the API calls are identical on the two screens —
 * only what you see differs.
 *
 * The screen is one <SectionList>: the create-claim form is its list header, the
 * claims are one section's rows, and the "History" heading with its search bar
 * is that section's header. A SectionList rather than a FlatList specifically so
 * the search bar can stick — `stickyHeaderIndices` on a FlatList would pin the
 * whole list header, which here is the entire form.
 *
 * Pagination is a scroll position: `onEndReached` calls the same `loadMore` the
 * classic screen's "Load More" button calls, revealing the same PAGE_SIZE rows.
 * Search narrows the set *before* that slice, so the two compose — a query
 * searches every claim and pagination then walks the matches.
 */
function ExpenseClaim() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Expense Claims");

  const {
    baseUrl,
    claims,
    filteredClaims,
    visibleClaims,
    isFetching,
    isError,
    error,
    refetch,
    isRefetching,
    refresh,
    searchQuery,
    setSearchQuery,
    isSearching,
    hasMore,
    loadMore,
    addClaim,
    isCreating,
    resetFormFlag,
  } = useExpenseClaims();

  /**
   * Claim ids that have already played their entrance.
   *
   * A ref, not state — writing to it must not re-render, and it has to outlive
   * the row it describes: the list unmounts rows that scroll out of the window,
   * and without this record each one would animate again on the way back.
   */
  const seen = useRef(new Set()).current;

  const listRef = useRef(null);

  // Through the scroll responder, not `scrollToLocation` — the only time this
  // button is on screen is when the section has no rows, and asking a
  // SectionList to scroll to item 0 of an empty section is out of range.
  const scrollToForm = useCallback(
    () =>
      listRef.current
        ?.getScrollResponder?.()
        ?.scrollTo({ y: 0, animated: true }),
    [],
  );

  const keyExtractor = useCallback(
    (claim, index) => claim?.name || `claim-${index}`,
    [],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <AppearingItem itemKey={keyExtractor(item)} seen={seen}>
        <ExpenseHistoryCard claim={item} baseUrl={baseUrl} style={CARD_STYLE} />
      </AppearingItem>
    ),
    [baseUrl, keyExtractor, seen],
  );

  // One section. The list is a flat run of claims; the section exists so its
  // header can be sticky.
  const sections = useMemo(
    () => [{ key: "history", data: visibleClaims }],
    [visibleClaims],
  );

  const renderSectionHeader = useCallback(
    () => (
      <HistorySectionHeader
        total={claims.length}
        matches={filteredClaims.length}
        searchQuery={searchQuery}
        onChangeSearch={setSearchQuery}
      />
    ),
    [claims.length, filteredClaims.length, searchQuery, setSearchQuery],
  );

  /**
   * The "nothing to show" states, rendered as the section's footer.
   *
   * Not `ListEmptyComponent`: a SectionList counts its section header and footer
   * as items, so a section with no data still has a non-zero item count and the
   * empty component never fires. The section footer is the slot that does what
   * `ListEmptyComponent` is meant to.
   */
  const renderSectionFooter = useCallback(() => {
    if (visibleClaims.length > 0) return null;

    if (isFetching) {
      return (
        <View style={GUTTER}>
          <ExpenseSkeleton count={3} />
        </View>
      );
    }

    // An error and an empty result were one state on the classic screen — both
    // showed "No expense claims yet." They're told apart here, because
    // "something went wrong" and "you haven't claimed anything" call for
    // different responses.
    if (isError) {
      return (
        <View style={GUTTER}>
          <StatusBanner
            tone="error"
            title="Couldn't load your claims"
            message={
              error?.message ||
              "Something went wrong while fetching expense claims."
            }
          />
          <Card style={{ marginTop: SPACING.md }}>
            <EmptyState
              icon="refresh-outline"
              title="Nothing to show"
              description="Check your connection, then try again."
              actionLabel="Try again"
              onActionPress={refetch}
            />
          </Card>
        </View>
      );
    }

    // A query that matched nothing is not an empty history — the claims are
    // still there, the words just didn't land. Offering "clear search" rather
    // than "create a claim" is the difference.
    if (isSearching) {
      return (
        <View style={GUTTER}>
          <Card>
            <EmptyState
              icon="search-outline"
              title="No matching expense claims"
              description="Try another keyword — you can search by type, amount, date, status or receipt name."
              actionLabel="Clear search"
              onActionPress={() => setSearchQuery("")}
            />
          </Card>
        </View>
      );
    }

    return (
      <View style={GUTTER}>
        <Card>
          <EmptyState
            icon="receipt-outline"
            title="No expense claims yet."
            description="Anything you claim will appear here with its approval status."
            actionLabel="Create expense claim"
            onActionPress={scrollToForm}
          />
        </Card>
      </View>
    );
  }, [
    visibleClaims.length,
    isFetching,
    isError,
    error,
    refetch,
    isSearching,
    setSearchQuery,
    scrollToForm,
  ]);

  const renderFooter = useCallback(
    () => (
      <View style={GUTTER}>
        <HistoryFooter
          hasMore={hasMore}
          isEmpty={visibleClaims.length === 0}
          showRetry={isError && visibleClaims.length > 0}
          onRetry={refetch}
        />
      </View>
    ),
    [hasMore, visibleClaims.length, isError, refetch],
  );

  const listHeader = useMemo(
    () => (
      <View style={GUTTER}>
        <ClaimFormSection
          addClaim={addClaim}
          isCreating={isCreating}
          resetFormFlag={resetFormFlag}
        />
      </View>
    ),
    [addClaim, isCreating, resetFormFlag],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        // The search bar pins under the navigation bar once the form has
        // scrolled past, so a query can be changed without scrolling back up.
        stickySectionHeadersEnabled
        contentContainerStyle={LIST_CONTENT}
        keyboardShouldPersistTaps="handled"
        // Dragging the results puts the keyboard away, which is what you want
        // the moment you stop typing and start reading.
        keyboardDismissMode="on-drag"
        // An element, not a function component: passing `() => <X/>` would make
        // the header a new component *type* every render, which remounts it —
        // and remounting a form throws away what the user has typed and drops
        // the keyboard.
        ListHeaderComponent={listHeader}
        ListFooterComponent={renderFooter}
        /* ---------------- Pagination ----------------
         * 0.5 means "within half a visible screen of the bottom", which is the
         * list's actual unit — a multiple of the viewport height from the end,
         * not a percentage of the list. With five ~150pt cards to a page that
         * fires around three quarters of the way down, and it stays right
         * regardless of how many pages are already revealed.
         *
         * Repeat fires are absorbed in the hook: `loadMore` is a no-op until the
         * previous increment has committed, so a burst advances exactly one page.
         */
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.primary2]}
            progressBackgroundColor={colors.cardBackground}
          />
        }
        /* ---------------- Rendering budget ----------------
         * One page is five cards, and a claim card is ~150pt, so five rows is
         * already more than a screenful — rendering that many up front means the
         * first page is complete before the user can scroll. `windowSize: 7`
         * keeps three screens of rows mounted either side of the viewport, which
         * is what stops a fast flick from hitting blank space.
         */
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        /* `removeClippedSubviews` is deliberately off.
         *
         * On Android it is the documented cause of rows going blank, and it is
         * worst exactly here — the list header is a form with live text inputs
         * and two modals, and the section header holds a third. The lists this
         * screen renders are tens of claims, not thousands, so clipping would
         * trade a real correctness risk for memory that windowSize has already
         * bounded.
         */
        removeClippedSubviews={false}
        // iOS keeps momentum scrolling smooth while rows are still rendering;
        // Android has no equivalent and ignores it.
        {...(Platform.OS === "ios" ? { scrollEventThrottle: 16 } : null)}
      />
    </SafeAreaView>
  );
}

export default ExpenseClaim;

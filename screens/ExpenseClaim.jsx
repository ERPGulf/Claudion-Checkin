import React, { useCallback, useRef } from "react";
import { FlatList, Platform, RefreshControl } from "react-native";
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
} from "../components/ExpenseClaim";

/**
 * Gap between claim cards. A module constant rather than an inline object, so
 * the memoised <ExpenseHistoryCard> gets the same style reference every render
 * and its shallow prop comparison actually holds.
 */
const CARD_GAP = { marginBottom: SPACING.md };

const LIST_CONTENT = {
  padding: SPACING.lg,
  paddingBottom: SPACING.xxxl,
};

/**
 * Modern Expense Claims.
 *
 * Presentation only. The history query, the create mutation, the attachment
 * upload and the page cursor live in hooks/useExpenseClaims.js; every form
 * field and `handleSubmit` live in hooks/useExpenseClaimForm.js. Both are
 * shared with ExpenseClaimLegacy, so validation, the payload and the API calls
 * are identical on the two screens — only what you see differs.
 *
 * The screen is one <FlatList>: the create-claim form is its header, the claims
 * are its rows. That is what lets pagination be a scroll position instead of a
 * button — `onEndReached` calls the same `loadMore` the classic screen's "Load
 * More" button calls, and reveals the same PAGE_SIZE rows off the same array.
 * The classic screen keeps its button; nothing about how a page is produced
 * changed on either.
 *
 * The form lives in <ClaimFormSection> rather than inline here for a specific
 * reason: it owns the form state, so typing an amount re-renders the header
 * subtree and nothing else. Held on this screen instead, every keystroke would
 * re-render the list.
 */
function ExpenseClaim() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Expense Claims");

  const {
    baseUrl,
    claims,
    visibleClaims,
    isFetching,
    isError,
    error,
    refetch,
    isRefetching,
    refresh,
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
   * the row it describes: FlatList unmounts rows that scroll out of the window,
   * and without this record each one would animate again on the way back.
   */
  const seen = useRef(new Set()).current;

  const listRef = useRef(null);

  const scrollToForm = useCallback(
    () => listRef.current?.scrollToOffset({ offset: 0, animated: true }),
    [],
  );

  const keyExtractor = useCallback(
    (claim, index) => claim?.name || `claim-${index}`,
    [],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <AppearingItem itemKey={keyExtractor(item)} seen={seen}>
        <ExpenseHistoryCard claim={item} baseUrl={baseUrl} style={CARD_GAP} />
      </AppearingItem>
    ),
    [baseUrl, keyExtractor, seen],
  );

  /**
   * A failure with claims already on screen is a failed refresh, not a dead
   * screen — the list underneath is still valid. That case gets the footer's
   * compact retry row; only a failure with nothing to show takes over the page.
   */
  const listIsEmpty = visibleClaims.length === 0;

  const renderEmpty = useCallback(() => {
    if (isFetching) return <ExpenseSkeleton count={3} />;

    // An error and an empty result were one state on the classic screen — both
    // showed "No expense claims yet." They're told apart here, because
    // "something went wrong" and "you haven't claimed anything" call for
    // different responses.
    if (isError) {
      return (
        <>
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
        </>
      );
    }

    return (
      <Card>
        <EmptyState
          icon="receipt-outline"
          title="No expense claims yet."
          description="Anything you claim will appear here with its approval status."
          actionLabel="Create expense claim"
          onActionPress={scrollToForm}
        />
      </Card>
    );
  }, [isFetching, isError, error, refetch, scrollToForm]);

  const renderFooter = useCallback(
    () => (
      <HistoryFooter
        hasMore={hasMore}
        isEmpty={listIsEmpty}
        showRetry={isError && !listIsEmpty}
        onRetry={refetch}
      />
    ),
    [hasMore, listIsEmpty, isError, refetch],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <FlatList
        ref={listRef}
        data={visibleClaims}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={LIST_CONTENT}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // An element, not a function component: passing `() => <X/>` would make
        // the header a new component *type* every render, which remounts it —
        // and remounting a form throws away what the user has typed and drops
        // the keyboard.
        ListHeaderComponent={
          <ClaimFormSection
            addClaim={addClaim}
            isCreating={isCreating}
            resetFormFlag={resetFormFlag}
            claimCount={claims.length}
          />
        }
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        /* ---------------- Pagination ----------------
         * 0.5 means "within half a visible screen of the bottom", which is
         * FlatList's actual unit — it is a multiple of the viewport height from
         * the end, not a percentage of the list. With five ~150pt cards to a
         * page that fires around three quarters of the way down, and it stays
         * right regardless of how many pages are already revealed, which a
         * percentage would not.
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
         * and two modals. The lists this screen renders are tens of claims, not
         * thousands, so clipping would trade a real correctness risk for memory
         * that windowSize has already bounded. Turn it on only if a tenant ever
         * shows up with a claim history long enough to need it.
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

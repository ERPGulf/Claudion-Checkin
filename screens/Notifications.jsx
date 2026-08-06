import React, { useCallback, useMemo } from "react";
import { Platform, RefreshControl, SectionList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useNotifications from "../hooks/useNotifications";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import SearchBar, { SearchCount } from "../components/common/SearchBar";
import {
  NotificationDateHeader,
  NotificationRow,
  NotificationSheet,
  NotificationSkeleton,
} from "../components/Notifications";

/** Page gutter, matching every other modern screen. */
const GUTTER = { paddingHorizontal: SPACING.lg };

const LIST_CONTENT = {
  paddingTop: SPACING.md,
  paddingBottom: SPACING.xxxl,
};

/**
 * Modern Notifications.
 *
 * Presentation only — the load, the mark-as-read flow, the unread-badge
 * decrement and the date grouping all live in hooks/useNotifications.js and
 * utils/notifications.js, faithful lifts of what NotificationsLegacy still runs
 * inline. No endpoint, no payload and no read/unread rule changed.
 *
 * The screen is one <SectionList>: a day is a section, its notifications are its
 * rows, and the date pill is that section's *sticky* header — so the day you are
 * reading stays named at the top of the window while you scroll, which is what
 * makes a long inbox navigable. Rows are memoised and the press handler is stable,
 * so typing in the search bar re-renders the container, not every row.
 *
 * Search is client-side and needs no new endpoint: `getNotifications(employeeId)`
 * already returns the entire list in one call — there is no cursor and no page
 * size to preserve, so there is no pagination behaviour to keep either.
 *
 * Tapping a row still opens the same in-screen sheet it always did (see
 * <NotificationSheet>) — nothing here navigates.
 */
function Notifications() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Notifications");

  const {
    sections,
    selected,
    loading,
    refreshing,
    searchQuery,
    setSearchQuery,
    refresh,
    openNotification,
    closeNotification,
    total,
    matches,
    unreadCount,
    isSearching,
  } = useNotifications();

  const keyExtractor = useCallback(
    (item, index) => item?.name || `notification-${index}`,
    [],
  );

  const renderItem = useCallback(
    ({ item, index, section }) => (
      <View style={GUTTER}>
        <View
          style={{
            backgroundColor: colors.cardBackground,
            borderStartWidth: 1,
            borderEndWidth: 1,
            borderColor: colors.cardBorder,
            // First and last row of a day carry the group's corners and its
            // remaining edges, so a section reads as one card. Per-row radii
            // rather than `overflow: hidden` on a wrapper — Android clips to the
            // bounding rect and would square these off.
            borderTopWidth: index === 0 ? 1 : 0,
            borderBottomWidth: index === section.data.length - 1 ? 1 : 0,
            borderTopStartRadius: index === 0 ? RADIUS.xl : 0,
            borderTopEndRadius: index === 0 ? RADIUS.xl : 0,
            borderBottomStartRadius:
              index === section.data.length - 1 ? RADIUS.xl : 0,
            borderBottomEndRadius:
              index === section.data.length - 1 ? RADIUS.xl : 0,
          }}
        >
          <NotificationRow
            notification={item}
            onPress={openNotification}
          />

          {index < section.data.length - 1 && (
            <View
              style={{
                height: 1,
                marginStart: SPACING.md + 40 + SPACING.md,
                backgroundColor: colors.dividerSubtle,
              }}
            />
          )}
        </View>
      </View>
    ),
    [colors.cardBackground, colors.cardBorder, colors.dividerSubtle, openNotification],
  );

  const renderSectionHeader = useCallback(
    ({ section }) => (
      <NotificationDateHeader
        label={section.date}
        count={section.data.length}
      />
    ),
    [],
  );

  /**
   * The subtitle and the search field.
   *
   * Not sticky — only the date headers pin, so the search bar scrolls away like
   * it does in Outlook and Notion rather than eating a permanent 44pt of a small
   * screen. The bar is hidden until there is something to search: a query over an
   * empty inbox can only ever return nothing.
   */
  const listHeader = useMemo(
    () => (
      <View style={[GUTTER, { paddingBottom: SPACING.sm }]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: total > 0 ? SPACING.md : 0,
          }}
        >
          <Text
            style={{ ...TYPO.caption, color: colors.textMuted, flex: 1 }}
            numberOfLines={2}
          >
            {unreadCount > 0
              ? `Stay up to date with your latest activity. ${unreadCount} unread.`
              : "Stay up to date with your latest activity."}
          </Text>

          {total > 0 && (
            <SearchCount
              matches={matches}
              total={total}
              noun="notification"
              style={{ marginStart: SPACING.sm }}
            />
          )}
        </View>

        {total > 0 && (
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search notifications…"
            accessibilityLabel="Search notifications"
          />
        )}
      </View>
    ),
    [
      colors.textMuted,
      matches,
      searchQuery,
      setSearchQuery,
      total,
      unreadCount,
    ],
  );

  /**
   * The "nothing to show" states.
   *
   * `ListEmptyComponent` rather than a section footer: a section only exists once
   * it has rows, so an empty list has no sections to hang a footer on.
   */
  const listEmpty = useMemo(() => {
    if (loading) {
      return <NotificationSkeleton />;
    }

    // A query that matched nothing is not an empty inbox — the notifications are
    // still there, the words just didn't land. Offering "clear search" rather
    // than "we'll notify you" is the difference.
    if (isSearching) {
      return (
        <View style={GUTTER}>
          <Card>
            <EmptyState
              icon="search-outline"
              title="No matching notifications"
              description="Try another keyword — search looks at both the title and the message."
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
            icon="notifications-outline"
            title="No notifications yet"
            description="We'll notify you when something important happens."
          />
        </Card>
      </View>
    );
  }, [isSearching, loading, setSearchQuery]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <SectionList
        sections={loading ? [] : sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        // The day you're reading stays named at the top of the window.
        stickySectionHeadersEnabled
        contentContainerStyle={LIST_CONTENT}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        keyboardShouldPersistTaps="handled"
        // Dragging the list puts the keyboard away, which is what you want the
        // moment you stop typing and start reading.
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.primary2]}
            progressBackgroundColor={colors.cardBackground}
          />
        }
        /* ---------------- Rendering budget ----------------
         * A row is ~76pt, so ten rows is more than a screenful — rendering that
         * many up front means the first screen is complete before the user can
         * scroll. `windowSize: 9` keeps four screens of rows mounted either side
         * of the viewport, which is what stops a fast flick through a long inbox
         * from hitting blank space.
         *
         * `removeClippedSubviews` stays off: on Android it is the documented
         * cause of rows going blank, and this list is tens of notifications, not
         * thousands, so clipping would trade a correctness risk for memory
         * `windowSize` has already bounded.
         */
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={9}
        removeClippedSubviews={false}
        {...(Platform.OS === "ios" ? { scrollEventThrottle: 16 } : null)}
      />

      <NotificationSheet
        notification={selected}
        onClose={closeNotification}
      />
    </SafeAreaView>
  );
}

export default Notifications;

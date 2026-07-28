import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RADIUS, SHADOWS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useAttendanceHistory from "../hooks/useAttendanceHistory";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import StatusBanner from "../components/common/StatusBanner";
import {
  AttendanceHistoryCard,
  HistorySectionHeader,
  HistorySkeleton,
} from "../components/AttendanceHistory";

/**
 * Modern Attendance History.
 *
 * Presentation only — the query, pagination cursor and error handling all live in
 * hooks/useAttendanceHistory.js, shared byte-for-byte with
 * AttendanceHistoryLegacy. Nothing here fetches, filters or sorts.
 *
 * The list is a SectionList of days. Each section holds a single item — the whole
 * day's rows — so a day renders as one continuous card with a soft shadow and
 * hairline dividers. One item per row would mean either a shadow behind every
 * row or visible seams where shadowed fragments meet.
 */
function AttendanceHistory() {
  const { colors, isDark } = useAppTheme();
  useModernScreenHeader("Attendance History");

  const {
    isLoading,
    isError,
    error,
    records,
    sections,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
    loadMore,
    refetch,
  } = useAttendanceHistory();

  const page = {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  };

  // One fade as the skeleton hands off to real rows, so the swap doesn't pop.
  // Deliberately not a per-row stagger: rows get recycled during pagination, so
  // a per-row animation would re-fire on scroll for content already on screen.
  // Declared before the early returns to keep hook order stable.
  const listOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) return;
    Animated.timing(listOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isLoading, listOpacity]);

  if (isLoading) {
    return (
      <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
        <HistorySkeleton />
      </SafeAreaView>
    );
  }

  // Same condition the classic screen used to show "No attendance records
  // found" — an error and an empty result were treated as one state there. Here
  // they're told apart, because "something went wrong" and "you have no records
  // yet" call for different responses from the user.
  if (isError) {
    return (
      <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
        <View style={{ padding: SPACING.lg }}>
          <StatusBanner
            tone="error"
            title="Couldn't load your history"
            message={
              error?.message ||
              "Something went wrong while fetching attendance history."
            }
          />
          <Card style={{ marginTop: SPACING.lg }}>
            <EmptyState
              icon="refresh-outline"
              title="Nothing to show"
              description="Check your connection, then try again."
              actionLabel="Try again"
              onActionPress={refetch}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (!records.length) {
    return (
      <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
        <View style={{ padding: SPACING.lg }}>
          <Card>
            <EmptyState
              icon="time-outline"
              title="No attendance yet"
              description="Your check-ins and check-outs will appear here once you start recording attendance."
              actionLabel="Refresh"
              onActionPress={refetch}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
      <Animated.View style={{ flex: 1, opacity: listOpacity }}>
        <SectionList
          sections={sections}
          // SectionList passes the item's index *within its section*, which is
          // always 0 here — one item per day — so indexing `sections` by it
          // would hand every section the same key. Key off the day's first
          // record id instead.
          keyExtractor={(rows) => rows[0]?.name ?? "day"}
          stickySectionHeadersEnabled
          contentContainerStyle={{
            paddingHorizontal: SPACING.lg,
            paddingBottom: SPACING.xxxl,
          }}
          renderSectionHeader={({ section }) => (
            <HistorySectionHeader title={section.title} count={section.count} />
          )}
          renderItem={({ item: rows }) => (
            <View
              style={{
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                backgroundColor: colors.cardBackground,
                // No `overflow: 'hidden'` — each row rounds its own outer
                // corners instead, because Android clips to the bounding rect
                // and would square the group off. Clipping would also cancel
                // this shadow on iOS.
                ...(isDark ? null : SHADOWS.card),
              }}
            >
              {rows.map((record, index) => (
                <AttendanceHistoryCard
                  key={`${record.name}-${index}`}
                  logType={record.log_type}
                  time={record.time}
                  deviceId={record.device_id}
                  showDate={false}
                  position={
                    rows.length === 1
                      ? "single"
                      : index === 0
                        ? "first"
                        : index === rows.length - 1
                          ? "last"
                          : "middle"
                  }
                />
              ))}
            </View>
          )}
          ListFooterComponent={
            <View style={{ paddingTop: SPACING.xl, alignItems: "center" }}>
              {isFetchingNextPage ? (
                <ActivityIndicator color={colors.textMuted} />
              ) : (
                !hasNextPage && (
                  <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                    That&apos;s everything
                  </Text>
                )
              )}
            </View>
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.2}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.textMuted}
              colors={[colors.primary2]}
              progressBackgroundColor={colors.cardBackground}
            />
          }
        />
      </Animated.View>
    </SafeAreaView>
  );
}

export default AttendanceHistory;

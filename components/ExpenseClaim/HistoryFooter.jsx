/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';
import ExpenseSkeleton from './ExpenseSkeleton';

/**
 * What sits below the last claim. Exactly one of four things:
 *
 * `retry`     — the last fetch failed while claims were already on screen (a
 *               pull-to-refresh that didn't land). A compact row, not a
 *               full-screen error: the list underneath is still valid and still
 *               readable, and blanking it to report a failed refresh would
 *               destroy more than the failure did.
 * `hasMore`   — placeholder cards shaped like the real ones. They sit below the
 *               fold, so reaching them *is* the trigger: by the time one is
 *               fully visible `onEndReached` has already fired and the real
 *               cards have replaced it. They double as the loading indicator,
 *               which is why there is no separate spinner — the reveal comes off
 *               an array already in memory, so a spinner would flash for a frame
 *               and read as a stutter.
 * `end`       — a hairline and one quiet line. Only once there is something to
 *               have reached the end of.
 * nothing     — an empty list; <ListEmptyComponent> is speaking instead.
 */
function HistoryFooter({ hasMore, isEmpty, showRetry, onRetry }) {
  const { colors } = useAppTheme();

  if (showRetry) {
    return (
      <View
        accessible
        accessibilityLabel="Couldn't load more expenses"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: SPACING.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.errorBorder,
          backgroundColor: colors.errorSurface,
        }}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={ICON.md}
          color={colors.errorText}
        />

        <Text
          style={{
            ...TYPO.subhead,
            flex: 1,
            minWidth: 0,
            marginStart: SPACING.sm,
            color: colors.textSecondary,
          }}
        >
          Couldn&apos;t load more expenses.
        </Text>

        <PressableScale
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={8}
          style={{
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.xs + 2,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: colors.errorBorder,
            backgroundColor: colors.cardBackground,
            marginStart: SPACING.sm,
          }}
        >
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '600',
              color: colors.errorText,
            }}
          >
            Retry
          </Text>
        </PressableScale>
      </View>
    );
  }

  if (hasMore) {
    return <ExpenseSkeleton count={2} label="Loading more expenses" />;
  }

  if (isEmpty) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: SPACING.xs,
        paddingBottom: SPACING.sm,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.cardBorder }} />
      <Text
        style={{
          ...TYPO.caption,
          color: colors.textMuted,
          marginHorizontal: SPACING.md,
        }}
      >
        You&apos;ve reached the end
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.cardBorder }} />
    </View>
  );
}

export default HistoryFooter;

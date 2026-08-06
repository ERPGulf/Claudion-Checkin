/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * A day's heading in the list — "TODAY", "YESTERDAY", "28 JAN 2026" — as a pill
 * on an opaque bar rather than grey text floating over the page.
 *
 * The label is whatever `formatDateLabel` produced; only its case and its
 * container changed. Uppercasing happens through `textTransform` so the string
 * itself, and therefore the section key and the grouping, are untouched.
 *
 * Opaque and full-width because this is a *sticky* section header: a transparent
 * one would have notification rows sliding visibly underneath it. `count` reads
 * how many landed that day, which is what makes a long list scannable by day.
 */
function NotificationDateHeader({ label, count }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        backgroundColor: colors.surfaceSecondary,
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.md,
        paddingBottom: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          paddingHorizontal: SPACING.sm,
          paddingVertical: 3,
          borderRadius: RADIUS.pill,
          backgroundColor: colors.neutralSurface,
          borderWidth: 1,
          borderColor: colors.neutralBorder,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            ...TYPO.caption2,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: colors.textSecondary,
          }}
        >
          {label}
        </Text>
      </View>

      {/* Hairline out to the edge, so the pill reads as a divider with a label on
          it rather than as a stray chip. */}
      <View
        style={{
          flex: 1,
          height: 1,
          marginStart: SPACING.sm,
          backgroundColor: colors.dividerSubtle,
        }}
      />

      {count > 0 && (
        <Text
          style={{
            ...TYPO.caption2,
            color: colors.textMuted,
            marginStart: SPACING.sm,
          }}
        >
          {count}
        </Text>
      )}
    </View>
  );
}

export default NotificationDateHeader;

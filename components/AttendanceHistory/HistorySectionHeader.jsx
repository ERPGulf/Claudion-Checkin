/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * Sticky day header for the history list.
 *
 * Lighter than the screen-level <SectionHeader> used on Home and Profile
 * (headline, not title3) because it repeats down the list — at title3 weight a
 * dozen of these compete with the rows they're labelling.
 *
 * Needs an opaque background: it's sticky, so rows scroll underneath it.
 */
function HistorySectionHeader({ title, count }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surfaceSecondary,
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.xl,
        paddingBottom: SPACING.sm,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...TYPO.headline, color: colors.textPrimary }}
      >
        {title}
      </Text>

      {count > 0 && (
        <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
          {count === 1 ? '1 entry' : `${count} entries`}
        </Text>
      )}
    </View>
  );
}

export default HistorySectionHeader;

/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import {
  Ionicons,
  MaterialCommunityIcons,
  AntDesign,
  Octicons,
} from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

const FAMILIES = { Ionicons, MaterialCommunityIcons, AntDesign, Octicons };

/**
 * A module container: light elevated card with a titled header and a body slot
 * for a feature grid. Replaces the full-bleed black header bars.
 *
 * The chevron renders only when `onPress` is supplied — a chevron on a
 * non-actionable header reads as a broken link.
 */
function ModuleCard({
  icon,
  iconFamily = 'Ionicons',
  title,
  subtitle,
  onPress,
  children,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const IconSet = FAMILIES[iconFamily] || Ionicons;

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.lg,
        paddingBottom: SPACING.md,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: RADIUS.md,
          backgroundColor: colors.iconBackground,
          alignItems: 'center',
          justifyContent: 'center',
          marginEnd: SPACING.md,
        }}
      >
        <IconSet name={icon} size={ICON.md} color={colors.textPrimary} />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ ...TYPO.headline, color: colors.textPrimary }}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={{ ...TYPO.caption, color: colors.textMuted, marginTop: 1 }}
          >
            {subtitle}
          </Text>
        )}
      </View>

      {!!onPress && (
        <Ionicons
          name="chevron-forward"
          size={ICON.md}
          color={colors.textMuted}
        />
      )}
    </View>
  );

  return (
    <View
      style={[
        {
          backgroundColor: colors.cardBackground,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          // No `overflow: hidden` here — on iOS it sets masksToBounds and the
          // card would lose its shadow. Children don't reach the rounded edges.
          //
          // In dark mode a shadow over a near-black page is invisible, so the
          // border plus the lighter `cardBackground` carry the elevation.
          ...(isDark ? null : SHADOWS.card),
        },
        style,
      ]}
    >
      {onPress ? (
        <PressableScale
          onPress={onPress}
          scaleTo={0.99}
          accessibilityLabel={title}
          hitSlop={0}
        >
          {header}
        </PressableScale>
      ) : (
        header
      )}

      <View style={{ height: 1, backgroundColor: colors.dividerSubtle }} />

      <View
        style={{
          paddingHorizontal: SPACING.md,
          paddingTop: SPACING.lg,
          paddingBottom: SPACING.xs,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default ModuleCard;

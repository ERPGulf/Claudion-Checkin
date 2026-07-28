/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import {
  Ionicons,
  MaterialCommunityIcons,
  AntDesign,
  Octicons,
  FontAwesome,
} from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

const FAMILIES = {
  Ionicons,
  MaterialCommunityIcons,
  AntDesign,
  Octicons,
  FontAwesome,
};

/** Two lines of caption2 — reserved on every tile so rows align. */
const LABEL_MIN_HEIGHT = TYPO.caption2.lineHeight * 2;

/**
 * One feature inside a module card: icon chip + wrapping label.
 *
 * Sized by `columns` (percentage width) rather than a fixed pt value, so the
 * grid reflows on small phones and tablets without media queries. `label`
 * accepts a string or an array of words — arrays are joined and allowed to
 * wrap, which is why call sites no longer hand-split labels onto two lines.
 *
 * `tint` and `iconColor` are escape hatches for callers that already resolved
 * theme colors; leave them unset to follow the active palette.
 */
function FeatureTile({
  icon,
  iconFamily = 'Ionicons',
  label,
  emphasis = false,
  tint,
  iconColor,
  columns = 4,
  onPress,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  badge,
  selected = false,
}) {
  const { colors } = useAppTheme();
  const IconSet = FAMILIES[iconFamily] || Ionicons;
  const text = Array.isArray(label) ? label.filter(Boolean).join(' ') : label;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.93}
      accessibilityLabel={accessibilityLabel || text}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      hitSlop={0}
      style={{
        width: `${100 / columns}%`,
        paddingHorizontal: SPACING.xs,
        marginBottom: SPACING.md,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: RADIUS.lg,
          backgroundColor: tint || colors.iconBackground,
          alignItems: 'center',
          justifyContent: 'center',
          ...(selected
            ? { borderWidth: 1.5, borderColor: colors.primary2 }
            : null),
        }}
      >
        <IconSet
          name={icon}
          size={ICON.lg}
          color={iconColor || colors.textPrimary}
        />
        {selected && (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              width: 18,
              height: 18,
              borderRadius: RADIUS.pill,
              backgroundColor: colors.primary2,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: colors.cardBackground,
            }}
          >
            <Ionicons name="checkmark" size={10} color={colors.white} />
          </View>
        )}
        {!selected && badge != null && badge !== false && (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: RADIUS.pill,
              backgroundColor: colors.red,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: colors.surfaceElevated,
            }}
          >
            <Text
              allowFontScaling={false}
              style={{ color: colors.white, fontSize: 9, fontWeight: '700' }}
            >
              {badge}
            </Text>
          </View>
        )}
      </View>

      <Text
        numberOfLines={2}
        style={{
          ...TYPO.caption2,
          marginTop: SPACING.sm,
          minHeight: LABEL_MIN_HEIGHT,
          textAlign: 'center',
          color: emphasis ? colors.textPrimary : colors.textSecondary,
          fontWeight: emphasis ? '600' : '500',
        }}
      >
        {text}
      </Text>
    </PressableScale>
  );
}

export default FeatureTile;

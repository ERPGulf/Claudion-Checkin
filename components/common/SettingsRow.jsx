/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

const FAMILIES = { Ionicons, MaterialCommunityIcons };

const CHIP_SIZE = 36;
/** Row inset + chip + gap — dividers start level with the title, Apple-style. */
const TEXT_INSET = SPACING.lg + CHIP_SIZE + SPACING.md;

/**
 * One line in a settings card: icon chip, title, optional description, and one
 * trailing element.
 *
 * The trailing slot is whichever of these is supplied, in order: `children` (a
 * Switch, a segmented control…), `value` (right-aligned text), or a chevron if
 * `onPress` is set. Rows are a fixed 60pt tall so a column of them lines up
 * whether or not each has a description, and so every row clears the 44pt
 * touch-target minimum on its own.
 */
function SettingsRow({
  icon,
  iconFamily = 'Ionicons',
  iconColor,
  iconTint,
  title,
  titleColor,
  description,
  value,
  onPress,
  children,
  disabled,
  accessibilityLabel,
}) {
  const { colors } = useAppTheme();
  const IconSet = FAMILIES[iconFamily] || Ionicons;

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 60,
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.lg,
      }}
    >
      {!!icon && (
        <View
          style={{
            width: CHIP_SIZE,
            height: CHIP_SIZE,
            borderRadius: RADIUS.md,
            backgroundColor: iconTint || colors.iconBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconSet
            name={icon}
            size={ICON.md}
            color={iconColor || colors.textPrimary}
          />
        </View>
      )}

      <View
        style={{
          flex: 1,
          marginStart: icon ? SPACING.md : 0,
          marginEnd: SPACING.md,
        }}
      >
        <Text style={{ ...TYPO.headline, color: titleColor || colors.textPrimary }}>
          {title}
        </Text>
        {!!description && (
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '400',
              color: colors.textMuted,
              marginTop: 2,
            }}
          >
            {description}
          </Text>
        )}
      </View>

      {children ||
        (value != null ? (
          <Text
            numberOfLines={2}
            style={{
              ...TYPO.subhead,
              color: colors.textMuted,
              textAlign: 'right',
              flexShrink: 1,
              maxWidth: '46%',
            }}
          >
            {value}
          </Text>
        ) : null)}

      {!!onPress && !children && (
        <Ionicons
          name="chevron-forward"
          size={ICON.md}
          color={colors.textMuted}
          style={{ marginStart: SPACING.xs }}
        />
      )}
    </View>
  );

  if (!onPress) return body;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.985}
      hitSlop={0}
      accessibilityLabel={accessibilityLabel || title}
    >
      {body}
    </PressableScale>
  );
}

/** Hairline between rows, inset to align with the titles above and below. */
export function RowDivider() {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        height: 1,
        marginStart: TEXT_INSET,
        backgroundColor: colors.dividerSubtle,
      }}
    />
  );
}

export default SettingsRow;

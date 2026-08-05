/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

const FAMILIES = { Ionicons, MaterialCommunityIcons };

const CHIP_SIZE = 36;

/**
 * Row rhythms. Each entry is self-consistent: `chip + padV * 2` is the row
 * height, and the divider indent is derived from the same numbers, so a divider
 * can never fall out of step with the chip it is supposed to clear.
 *
 * `default` is Profile's rhythm and must not change — Profile, Attendance
 * Action, the appearance setting and the New-UI setting all render at these
 * numbers today.
 *
 * `comfortable` is for property lists read at a glance rather than tapped
 * through: a larger chip, 16pt gutters on both sides of the text, and a 64pt
 * row. Opt in per row.
 */
const ROW_SIZES = {
  default: { chip: CHIP_SIZE, gap: SPACING.md, padV: SPACING.md },
  comfortable: { chip: 44, gap: SPACING.lg, padV: 10 },
};

const rowMetrics = (size) => ROW_SIZES[size] || ROW_SIZES.default;

/** Divider indent for a given rhythm: row inset + chip + gap. */
const textInset = (size) => {
  const { chip, gap } = rowMetrics(size);
  return SPACING.lg + chip + gap;
};

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
  size = 'default',
}) {
  const { colors } = useAppTheme();
  const IconSet = FAMILIES[iconFamily] || Ionicons;
  const { chip, gap, padV } = rowMetrics(size);

  // Android pads a line box by the font's own ascent/descent on top of an
  // explicit lineHeight, which lifts a single line optically above the chip it
  // sits beside. Only applied in the `comfortable` rhythm so the default rows
  // stay pixel-identical to what Profile ships today.
  const centredText =
    size === 'comfortable'
      ? { includeFontPadding: false, textAlignVertical: 'center' }
      : null;

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: chip + padV * 2,
        paddingVertical: padV,
        paddingHorizontal: SPACING.lg,
      }}
    >
      {!!icon && (
        <View
          style={{
            width: chip,
            height: chip,
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
          minWidth: 0,
          marginStart: icon ? gap : 0,
          marginEnd: gap,
        }}
      >
        <Text
          style={{
            ...TYPO.headline,
            color: titleColor || colors.textPrimary,
            ...centredText,
          }}
        >
          {title}
        </Text>
        {!!description && (
          <Text
            style={{
              ...TYPO.subhead,
              fontWeight: '400',
              // `textSecondary` (7.6:1) rather than `textMuted` (4.6:1) in the
              // comfortable rhythm: a description there is content, not a hint,
              // and 4.6:1 is only just over the floor for small text.
              color:
                size === 'comfortable' ? colors.textSecondary : colors.textMuted,
              marginTop: 2,
              ...centredText,
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
              // `subhead` is already medium (500), which is the weight a plain
              // value wants — it reads as a peer of a badge label rather than as
              // body copy. Spelling it out again here would be dead code.
              ...TYPO.subhead,
              color: colors.textMuted,
              textAlign: 'right',
              flexShrink: 1,
              maxWidth: '46%',
              ...centredText,
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

/**
 * Hairline between rows, inset to align with the titles above and below.
 *
 * Takes the same `size` as the rows it separates, so the indent tracks the chip
 * width. Spacing above and below comes from the rows' own symmetric
 * `paddingVertical` — the divider adds no margin of its own, which is what keeps
 * the gap identical on both sides.
 */
export function RowDivider({ size = 'default' }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        height: 1,
        marginStart: textInset(size),
        backgroundColor: colors.dividerSubtle,
      }}
    />
  );
}

export default SettingsRow;

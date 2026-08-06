/* eslint-disable react/prop-types */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import BottomSheet from './BottomSheet';
import PressableScale from './PressableScale';
import EmptyState from './EmptyState';

/** Chip size and the divider indent derived from it. */
const CHIP = 36;

/**
 * A single-choice list in a bottom sheet: the app's replacement for
 * `@react-native-picker/picker`.
 *
 * The wheel renders a full inline control on iOS — roughly a fifth of the screen
 * spent on something idle most of the time — and an unstyled system dialog on
 * Android, so the same field looked like two different products. A sheet costs
 * one row until it is opened, and looks the same on both.
 *
 * Generalised out of <ExpenseTypeSheet> when Leave Application needed the same
 * control. The options are plain strings straight from the server, and the value
 * handed back is the untouched string — so whatever payload the wheel produced,
 * this produces too. `iconForOption` only picks a picture to make the list
 * scannable; it is never part of the value.
 *
 * The panel, backdrop, header, close button and swipe-to-dismiss all come from
 * <BottomSheet>, shared with the attachment picker.
 */
function OptionSheet({
  visible,
  onClose,
  title,
  subtitle,
  options = [],
  selected,
  onSelect,
  iconForOption,
  emptyIcon = 'list-outline',
  emptyTitle = 'Nothing to choose from',
  emptyDescription,
  maxHeightRatio = 0.6,
}) {
  const { colors } = useAppTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      closeLabel="Close"
      maxHeightRatio={maxHeightRatio}
    >
      {options.length === 0 ? (
        <EmptyState
          compact
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ScrollView
          accessibilityRole="radiogroup"
          accessibilityLabel={title}
          contentContainerStyle={{ paddingVertical: SPACING.sm }}
          showsVerticalScrollIndicator={false}
        >
          {options.map((option, index) => {
            const isSelected = option === selected;

            return (
              <View key={option}>
                {index > 0 && (
                  <View
                    style={{
                      height: 1,
                      marginStart: SPACING.lg + CHIP + SPACING.md,
                      backgroundColor: colors.dividerSubtle,
                    }}
                  />
                )}

                <PressableScale
                  onPress={() => onSelect?.(option)}
                  scaleTo={0.99}
                  hitSlop={0}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={option}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: SPACING.lg,
                    paddingVertical: SPACING.md,
                    minHeight: 60,
                  }}
                >
                  <View
                    style={{
                      width: CHIP,
                      height: CHIP,
                      borderRadius: RADIUS.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isSelected
                        ? colors.accentSurface
                        : colors.iconBackground,
                    }}
                  >
                    <Ionicons
                      name={iconForOption ? iconForOption(option) : 'ellipse-outline'}
                      size={ICON.md}
                      color={isSelected ? colors.accentText : colors.textPrimary}
                    />
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{
                      ...TYPO.headline,
                      flex: 1,
                      minWidth: 0,
                      marginStart: SPACING.md,
                      color: colors.textPrimary,
                    }}
                  >
                    {option}
                  </Text>

                  {isSelected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={ICON.md}
                      color={colors.successText}
                    />
                  )}
                </PressableScale>
              </View>
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

export default OptionSheet;

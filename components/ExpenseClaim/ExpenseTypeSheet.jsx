/* eslint-disable react/prop-types */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import BottomSheet from '../common/BottomSheet';
import PressableScale from '../common/PressableScale';
import EmptyState from '../common/EmptyState';
import { expenseTypeIcon } from '../../utils/expenseClaims';

/**
 * The expense-type chooser, as a bottom sheet instead of a wheel.
 *
 * `@react-native-picker/picker` renders a full inline wheel on iOS — roughly a
 * fifth of the screen spent on a control that is idle most of the time — and an
 * unstyled system dialog on Android, so the same field looked like two different
 * products. A sheet costs one row until it is opened, and looks the same on both.
 *
 * The panel, backdrop, header, close button and swipe-to-dismiss all come from
 * <BottomSheet>, shared with the attachment picker — this file is only the list
 * that goes inside.
 *
 * The list is whatever `get_expense_claim_type` returned; the value handed back
 * is the raw server string, so the payload is byte-identical to the wheel's.
 * Each row gets a glyph from the type's name (see `expenseTypeIcon`) purely so
 * the list is scannable — the icon is never part of the value.
 *
 * The sheet is capped at 60% of the window and the list scrolls inside it, so a
 * tenant with thirty configured types cannot push it off screen.
 */
function ExpenseTypeSheet({ visible, types = [], selected, onSelect, onClose }) {
  const { colors } = useAppTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Expense type"
      subtitle="What kind of expense was this?"
      closeLabel="Close"
      maxHeightRatio={0.6}
    >
      {types.length === 0 ? (
        <EmptyState
          compact
          icon="pricetags-outline"
          title="No expense types"
          description="Your administrator hasn't configured any expense claim types yet."
        />
      ) : (
        <ScrollView
          accessibilityRole="radiogroup"
          accessibilityLabel="Expense type"
          contentContainerStyle={{ paddingVertical: SPACING.sm }}
          showsVerticalScrollIndicator={false}
        >
          {types.map((type, index) => {
            const isSelected = type === selected;

            return (
              <View key={type}>
                {index > 0 && (
                  <View
                    style={{
                      height: 1,
                      marginStart: SPACING.lg + 36 + SPACING.md,
                      backgroundColor: colors.dividerSubtle,
                    }}
                  />
                )}

                <PressableScale
                  onPress={() => onSelect?.(type)}
                  scaleTo={0.99}
                  hitSlop={0}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={type}
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
                      width: 36,
                      height: 36,
                      borderRadius: RADIUS.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isSelected
                        ? colors.accentSurface
                        : colors.iconBackground,
                    }}
                  >
                    <Ionicons
                      name={expenseTypeIcon(type)}
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
                    {type}
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

export default ExpenseTypeSheet;

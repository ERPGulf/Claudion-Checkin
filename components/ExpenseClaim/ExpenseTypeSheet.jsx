/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
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
 * The list is whatever `get_expense_claim_type` returned; the value handed back
 * is the raw server string, so the payload is byte-identical to the wheel's.
 * Each row gets a glyph from the type's name (see `expenseTypeIcon`) purely so
 * the list is scannable — the icon is never part of the value.
 *
 * Height is capped at 60% of the window and the list scrolls inside it, so a
 * tenant with thirty configured types cannot push the sheet off screen.
 */
function ExpenseTypeSheet({ visible, types = [], selected, onSelect, onClose }) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* The backdrop dismisses; the sheet itself swallows the press so a tap
          inside the list can't close it. */}
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close expense type list"
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(11,11,20,0.35)',
        }}
      >
        <Pressable onPress={() => {}}>
          <Animated.View
            style={{
              maxHeight: windowHeight * 0.6,
              backgroundColor: colors.cardBackground,
              borderTopStartRadius: RADIUS.xxl,
              borderTopEndRadius: RADIUS.xxl,
              borderTopWidth: 1,
              borderColor: colors.cardBorder,
              paddingBottom: Math.max(insets.bottom, SPACING.lg),
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [320, 0],
                  }),
                },
              ],
            }}
          >
            {/* Grab handle — the affordance that says this panel can be
                dismissed downwards, even though the gesture itself is a tap. */}
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: RADIUS.pill,
                backgroundColor: colors.cardBorder,
                marginTop: SPACING.md,
                marginBottom: SPACING.sm,
              }}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: SPACING.lg,
                paddingBottom: SPACING.md,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.title3, color: colors.textPrimary, flex: 1 }}
              >
                Expense type
              </Text>

              <PressableScale
                onPress={onClose}
                accessibilityLabel="Close"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: RADIUS.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.iconBackground,
                }}
              >
                <Ionicons
                  name="close"
                  size={ICON.sm}
                  color={colors.textSecondary}
                />
              </PressableScale>
            </View>

            <View style={{ height: 1, backgroundColor: colors.dividerSubtle }} />

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
                            color={
                              isSelected ? colors.accentText : colors.textPrimary
                            }
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
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default ExpenseTypeSheet;

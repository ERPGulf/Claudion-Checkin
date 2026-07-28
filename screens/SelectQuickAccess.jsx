import { View, ScrollView } from 'react-native';
import React, { useLayoutEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { ICON, RADIUS, SPACING } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import Card from '../components/common/Card';
import FeatureTile from '../components/common/FeatureTile';
import PressableScale from '../components/common/PressableScale';
import SectionHeader from '../components/common/SectionHeader';
import {
  activeButtonsSelector,
  setAdd,
  setRemove,
} from '../redux/Slices/QuickAccessSlice';

/** Three across keeps the two-word labels on two lines at 11pt. */
const COLUMNS = 3;

/**
 * Everything a user can pin to Home.
 *
 * `id` is the identity Redux matches on and is persisted inside each pinned
 * entry, so ids must never be reused or renumbered — 3, 5 and 6 stay retired
 * (they were the never-shipped Vacation request / My Card / Contacts entries).
 * `iconName` has to stay unique too: both this grid and Home's Quick Access row
 * key their tiles by it.
 *
 * `url` must match a route registered in navigation/app-navigator.jsx —
 * __tests__/quickAccessOptions.test.js enforces that.
 */
export const QUICK_ACCESS_OPTIONS = [
  {
    id: 1,
    iconName: 'calendar-outline',
    text1: 'Attendance',
    text2: 'action',
    url: 'Attendance action',
  },
  {
    id: 2,
    iconName: 'receipt-outline',
    text1: 'Attendance',
    text2: 'history',
    url: 'Attendance history',
  },
  {
    id: 9,
    iconName: 'clipboard-outline',
    text1: 'Attendance',
    text2: 'request',
    url: 'Attendance request',
  },
  {
    id: 10,
    iconName: 'location-outline',
    text1: 'Automatic',
    text2: 'attendance',
    url: 'Auto attendance',
  },
  {
    id: 12,
    iconName: 'document-text-outline',
    text1: 'Leave',
    text2: 'request',
    url: 'Leave request',
  },
  {
    id: 11,
    iconName: 'wallet-outline',
    text1: 'Expense',
    text2: 'claim',
    url: 'Expense claim',
  },
  {
    id: 13,
    iconName: 'card-outline',
    text1: 'Salary',
    text2: 'advance',
    url: 'Salary advance',
  },
  {
    id: 14,
    iconName: 'chatbox-ellipses-outline',
    text1: 'Complaints',
    url: 'Complaints',
  },
  {
    id: 4,
    iconName: 'list-outline',
    text1: 'Vacation',
    text2: 'list',
    url: 'comingsoon',
  },
  {
    id: 8,
    iconName: 'trail-sign-outline',
    text1: 'Trip',
    text2: 'details',
    url: 'Trip details',
  },
  {
    id: 7,
    iconName: 'qr-code-outline',
    text1: 'My QR',
    url: 'My QR Code',
  },
];

function SelectQuickAccess() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: 'Quick Access',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: colors.surfaceSecondary },
      headerTitleStyle: { color: colors.textPrimary },
      headerTintColor: colors.textPrimary,
      headerLeft: () => (
        <PressableScale
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          style={{
            width: 36,
            height: 36,
            borderRadius: RADIUS.pill,
            backgroundColor: colors.iconBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="chevron-back"
            size={ICON.md}
            color={colors.textPrimary}
          />
        </PressableScale>
      ),
    });
  }, [navigation, colors.surfaceSecondary, colors.textPrimary, colors.iconBackground]);

  const activeButtons = useSelector(activeButtonsSelector);
  const dispatch = useDispatch();
  const handleClick = item => {
    if (activeButtons?.some(button => button?.id === item.id)) {
      dispatch(setRemove(item));
    } else {
      dispatch(setAdd(item)); // You probably want to dispatch here
    }
  };

  const pinnedCount = QUICK_ACCESS_OPTIONS.filter(item =>
    activeButtons?.some(button => button?.id === item.id),
  ).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: SPACING.xxxl,
        }}
      >
        <SectionHeader
          title="Available shortcuts"
          subtitle={`${pinnedCount} of ${QUICK_ACCESS_OPTIONS.length} pinned to your Home screen`}
        />

        <Card style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {QUICK_ACCESS_OPTIONS.map(item => {
              const isPinned = activeButtons?.some(
                button => button?.id === item?.id,
              );

              return (
                <FeatureTile
                  key={item.iconName}
                  icon={item.iconName}
                  label={[item.text1, item.text2]}
                  columns={COLUMNS}
                  selected={isPinned}
                  emphasis={isPinned}
                  tint={isPinned ? colors.accentSurface : colors.iconBackground}
                  iconColor={isPinned ? colors.primary2 : colors.textPrimary}
                  onPress={() => handleClick(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isPinned }}
                  accessibilityLabel={`${item.text1} ${item.text2 || ''}`.trim()}
                />
              );
            })}
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

export default SelectQuickAccess;

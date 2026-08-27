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
import {
  QUICK_ACCESS_OPTIONS,
  availableQuickAccessOptions,
} from '../utils/quickAccess';
import { selectFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';

/** Three across keeps the two-word labels on two lines at 11pt. */
const COLUMNS = 3;

/** Re-exported for the existing importers (and tests) of this screen. */
export { QUICK_ACCESS_OPTIONS };

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

  // The catalogue minus anything the server has disabled, so a feature that is
  // off cannot be pinned back onto Home from here.
  const featureSettings = useSelector(selectFeatureSettings);
  const options = availableQuickAccessOptions(featureSettings);

  const pinnedCount = options.filter(item =>
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
          subtitle={`${pinnedCount} of ${options.length} pinned to your Home screen`}
        />

        <Card style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {options.map(item => {
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

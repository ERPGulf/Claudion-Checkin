import { t, useTranslation } from "../localization";
import { View, ScrollView } from 'react-native';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { SPACING } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import useModernScreenHeader from '../hooks/useModernScreenHeader';
import Card from '../components/common/Card';
import FeatureTile from '../components/common/FeatureTile';
import SectionHeader from '../components/common/SectionHeader';
import {
  activeButtonsSelector,
  setAdd,
  setRemove,
} from '../redux/Slices/QuickAccessSlice';
import {
  QUICK_ACCESS_OPTIONS,
  quickAccessLabel,
  availableQuickAccessOptions,
} from '../utils/quickAccess';
import { selectFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';

/** Three across keeps the two-word labels on two lines at 11pt. */
const COLUMNS = 3;

/** Re-exported for the existing importers (and tests) of this screen. */
export { QUICK_ACCESS_OPTIONS };

function SelectQuickAccess() {
  useTranslation();
  const { colors } = useAppTheme();
  useModernScreenHeader(t("Quick Access"));

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
          title={t("Available shortcuts")}
          subtitle={t('{{count}} of {{total}} pinned to your Home screen', { count: pinnedCount, total: options.length })}
        />

        <Card style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {options.map(item => {
              const isPinned = activeButtons?.some(
                button => button?.id === item?.id,
              );

              return (
                <FeatureTile
                  key={item.iconName}
                  icon={item.iconName}
                  label={quickAccessLabel(item)}
                  columns={COLUMNS}
                  selected={isPinned}
                  emphasis={isPinned}
                  tint={isPinned ? colors.accentSurface : colors.iconBackground}
                  iconColor={isPinned ? colors.primary2 : colors.textPrimary}
                  onPress={() => handleClick(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isPinned }}
                  accessibilityLabel={quickAccessLabel(item)}
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

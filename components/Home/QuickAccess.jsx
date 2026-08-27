import React from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { RADIUS, SHADOWS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { activeButtonsSelector } from '../../redux/Slices/QuickAccessSlice';
import { filterOfferedShortcuts } from '../../utils/quickAccess';
import { selectFeatureSettings } from '../../redux/Slices/FeatureSettingsSlice';
import SectionHeader from '../common/SectionHeader';
import FeatureTile from '../common/FeatureTile';
import EmptyState from '../common/EmptyState';

const COLUMNS = 4;

/**
 * User-pinned shortcuts. Behaviour is unchanged — the same Redux selector, the
 * same `navigation.navigate(item.url)` on tap, the same "Quick access" screen
 * for editing. Only the container changed: an elevated card with a real empty
 * state instead of a dashed 2px placeholder box.
 */
function QuickAccess() {
  const navigation = useNavigation();
  const { colors, isDark } = useAppTheme();
  const activeButtons = useSelector(activeButtonsSelector);
  const featureSettings = useSelector(selectFeatureSettings);
  // Pins are persisted, so retired shortcuts — and shortcuts whose feature the
  // server has since turned off — have to be dropped on read.
  const shortcuts = filterOfferedShortcuts(activeButtons, featureSettings);
  const hasShortcuts = shortcuts.length > 0;

  const openPicker = () => navigation.navigate('Quick access');

  return (
    <View style={{ width: '100%' }}>
      <SectionHeader
        title="Quick Access"
        actionLabel={hasShortcuts ? 'Edit' : 'Add New'}
        actionIcon={hasShortcuts ? 'options-outline' : 'add'}
        onActionPress={openPicker}
      />

      <View
        style={{
          backgroundColor: colors.cardBackground,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          paddingHorizontal: SPACING.md,
          paddingTop: hasShortcuts ? SPACING.lg : 0,
          paddingBottom: hasShortcuts ? SPACING.xs : 0,
          ...(isDark ? null : SHADOWS.card),
        }}
      >
        {hasShortcuts ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {shortcuts.map(item => (
              <FeatureTile
                key={item?.iconName}
                icon={item?.iconName}
                label={[item?.text1, item?.text2]}
                columns={COLUMNS}
                tint={colors.accentSurface}
                iconColor={colors.primary2}
                onPress={() => {
                  if (item?.url) navigation.navigate(item.url);
                }}
              />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="flash-outline"
            title="Pin your most-used actions"
            description="Add shortcuts here to reach the features you use every day in one tap."
            actionLabel="Add shortcuts"
            onActionPress={openPicker}
          />
        )}
      </View>
    </View>
  );
}

export default QuickAccess;

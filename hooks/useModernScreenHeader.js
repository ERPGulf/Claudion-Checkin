import React, { useLayoutEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ICON, RADIUS } from '../constants';
import useAppTheme from './useAppTheme';
import PressableScale from '../components/common/PressableScale';

/**
 * The modern stack header: themed bar, centred title, and a circular back
 * button on a tinted chip instead of a bare oversized chevron.
 *
 * Extracted from the modern Attendance Action screen so every modern stack
 * screen gets a byte-identical header — the block was going to be copy-pasted
 * per screen otherwise, and a header that drifts between screens is exactly what
 * makes an app feel assembled rather than designed.
 *
 * Uses `navigation.setOptions` rather than rendering a header inside the screen,
 * because the native-stack header already handles the safe-area inset, the title
 * transition and the swipe-back gesture.
 */
export default function useModernScreenHeader(title) {
  const navigation = useNavigation();
  const { colors } = useAppTheme();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: title,
      headerTitleAlign: 'center',
      statusBarTranslucent: false,
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
  }, [
    navigation,
    title,
    colors.surfaceSecondary,
    colors.textPrimary,
    colors.iconBackground,
  ]);
}

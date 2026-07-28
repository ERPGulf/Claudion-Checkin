import { View, Text } from 'react-native';
import React, { useLayoutEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { TYPO } from '../constants';
import useAppTheme from '../hooks/useAppTheme';

function Chat() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: 'Chat',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: colors.surfaceSecondary },
      headerTitleStyle: { color: colors.textPrimary },
      headerTintColor: colors.textPrimary,
    });
  }, [navigation, colors.surfaceSecondary, colors.textPrimary]);

  return (
    <View
      className="items-center justify-center flex-1"
      style={{ backgroundColor: colors.surfaceSecondary }}
    >
      <Text style={{ ...TYPO.body, color: colors.textMuted }}>Coming soon!</Text>
    </View>
  );
}

export default Chat;

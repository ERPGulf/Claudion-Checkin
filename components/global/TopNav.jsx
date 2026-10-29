import { useTranslation } from '../../localization';
import { View, TouchableOpacity } from 'react-native';
import Text from '../../localization/LocalizedText';
import React from 'react';
import { Entypo } from '@expo/vector-icons';
import { COLORS, SIZES } from '../../constants';

function TopNav({ navigation, title }) {
  const { language, direction, isRTL } = useTranslation();
  return (
    <View
      style={{
        width: '100%',
      }}
    >
      <View className="flex-row pb-4 pt-2 items-center justify-center relative">
        <TouchableOpacity
          className="absolute pb-4 pt-2"
          style={{ start: 0 }}
          onPress={() => navigation.goBack()}
        >
          <Entypo
            name={isRTL ? "chevron-right" : "chevron-left"}
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
        <View className="justify-self-center text-center">
          <Text className="text-lg font-medium">{title}</Text>
        </View>
      </View>
    </View>
  );
}

export default TopNav;

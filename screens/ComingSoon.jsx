import Text from '../localization/LocalizedText';
import { t, useTranslation } from "../localization";
import { View, TouchableOpacity } from 'react-native';
import React, { useLayoutEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import Entypo from '@expo/vector-icons/Entypo';
import { COLORS, SIZES } from '../constants';

function ComingSoon() {
  const { isRTL, language } = useTranslation();
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: t("Coming soon"),
      headerTitleAlign: 'center',
      headerLeft: () => (
        <TouchableOpacity className="" onPress={() => navigation.goBack()}>
          <Entypo
            name={isRTL ? "chevron-right" : "chevron-left"}
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, isRTL, language]);
  return (
    <View className="flex-1 justify-center items-center">
      <Text>{t("Coming soon!")}</Text>
    </View>
  );
}

export default ComingSoon;

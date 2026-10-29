import { t, useTranslation } from '../../localization';

import { ActivityIndicator, View } from 'react-native';
import Text from '../../localization/LocalizedText';
import { COLORS } from "../../constants";

function RenderLoader({ isLoading, hasNextPage }) {
  const { language, direction, isRTL } = useTranslation();
  if (isLoading || hasNextPage) {
    return (
      <View className="my-1">
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View className="my-1 items-center">
      <Text className="text-gray-500 text-sm">{t("No more data")}</Text>
    </View>
  );
}

export default RenderLoader;

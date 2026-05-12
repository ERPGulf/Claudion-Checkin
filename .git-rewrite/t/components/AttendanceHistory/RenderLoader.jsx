
import { ActivityIndicator, Text, View } from "react-native";
import { COLORS } from "../../constants";

function RenderLoader({ isLoading, hasNextPage }) {
  if (isLoading || hasNextPage) {
    return (
      <View className="my-1">
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View className="my-1 items-center">
      <Text className="text-gray-500 text-sm">No more data</Text>
    </View>
  );
}

export default RenderLoader;

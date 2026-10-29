import { t, useTranslation } from '../../localization';
import React from "react";
import { View, TouchableOpacity, Image } from 'react-native';
import Text from '../../localization/LocalizedText';

export default function AttachmentPicker({
  file,
  onPick,
  onRemove,
  label = t("Attach file (optional)"),
}) {
  useTranslation();
  return (
    <View className="mb-3">
      <Text className="text-sm font-medium text-gray-700 mb-1">{t("Attachment (optional)")}</Text>

      <TouchableOpacity
        onPress={onPick}
        className={`border p-3 rounded items-center ${
          file
            ? "bg-green-100 border-green-500"
            : "bg-gray-50 border-gray-300"
        }`}
      >
        <Text
          className={`${
            file ? "text-green-700 font-semibold" : "text-gray-700"
          }`}
        >
          {file ? t("Attached: {{name}} ✅", { name: file.name }) : label}
        </Text>
      </TouchableOpacity>

      {file && (
        <View className="mt-2 relative">
          {file.type?.startsWith("image") ? (
            <Image
              source={{ uri: file.uri }}
              className="w-full h-40 rounded"
              resizeMode="cover"
            />
          ) : (
            <View className="border p-3 bg-gray-200 rounded">
              <Text>{file.name}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={t("Remove attachment")}
            className="absolute top-2 bg-red-500 p-1 rounded-full"
           style={{ end: 8 }}>
            <Text className="text-white text-sm font-semibold">×</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

import React from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";

export default function AttachmentPicker({
  file,
  onPick,
  onRemove,
  label = "Attach file (optional)",
}) {
  return (
    <View className="mb-3">
      <Text className="text-sm font-medium text-gray-700 mb-1">
        Attachment (optional)
      </Text>

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
          {file ? `Attached: ${file.name} ✅` : label}
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
            className="absolute top-2 right-2 bg-red-500 p-1 rounded-full"
          >
            <Text className="text-white text-sm font-semibold">X</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

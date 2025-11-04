import { View, Text, Image, TouchableOpacity, Linking } from "react-native";
import React from "react";
import { Ionicons } from "@expo/vector-icons";

function ExpenseCard({ claim }) {
  const getStatusStyle = (status) => {
    switch (status?.toLowerCase()) {
      case "approved":
        return "bg-green-100 text-green-800 border border-green-300";
      case "rejected":
        return "bg-red-100 text-red-800 border border-red-300";
      case "pending":
        return "bg-yellow-100 text-yellow-800 border border-yellow-300";
      default:
        return "bg-gray-100 text-gray-700 border border-gray-300";
    }
  };

  // ✅ Only use file_url now (backend consistent)
  const filePaths = Array.isArray(claim.file_url)
    ? claim.file_url
    : claim.file_url
      ? [claim.file_url]
      : [];

  return (
    <View className="mb-3 p-4 bg-gray-100 rounded-lg shadow-sm">
      <Text className="text-base font-semibold mb-1 text-gray-900">
        {claim.title || "Expense Claim"}
      </Text>

      <Text className="text-sm text-gray-700 mb-1">
        Amount:{" "}
        <Text className="font-semibold text-gray-900">₹{claim.amount}</Text>
      </Text>

      <Text className="text-sm text-gray-700 mb-1">
        Date: {claim.expense_date || "N/A"}
      </Text>

      <Text className="text-sm text-gray-700 mb-1">
        Type:{" "}
        {claim.expense_type
          ? claim.expense_type.charAt(0).toUpperCase() +
            claim.expense_type.slice(1)
          : "N/A"}
      </Text>

      {claim.description && (
        <Text className="text-sm text-gray-600 mb-2 italic">
          {claim.description}
        </Text>
      )}

      {/* ✅ Attachments Section */}
      {filePaths.length > 0 ? (
        filePaths.map((file, idx) => {
          const fileUrl =
            typeof file === "string"
              ? `https://aysha.erpgulf.com${file}`
              : file?.url;

          const fileName = file?.name || fileUrl?.split("/").pop();
          const isImage =
            file?.type?.startsWith("image") ||
            fileUrl?.match(/\.(png|jpg|jpeg|gif)$/i);

          return (
            <TouchableOpacity
              key={idx}
              onPress={() => fileUrl && Linking.openURL(fileUrl)}
              className="mb-2 p-2 bg-gray-200 rounded flex-row items-center"
            >
              {isImage ? (
                <Image
                  source={{ uri: fileUrl }}
                  className="w-12 h-12 rounded mr-3"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-12 h-12 mr-3 items-center justify-center bg-gray-300 rounded">
                  <Ionicons
                    name="document-text-outline"
                    size={28}
                    color="#4B5563"
                  />
                </View>
              )}
              <Text className="text-gray-700" numberOfLines={1}>
                {fileName || "Attachment"}
              </Text>
            </TouchableOpacity>
          );
        })
      ) : (
        <Text className="text-xs text-gray-400 mt-1">No attachments</Text>
      )}

      {claim.status && (
        <View
          className={`self-start mt-3 px-3 py-1 rounded-full ${getStatusStyle(
            claim.status
          )}`}
        >
          <Text className="text-xs font-medium uppercase tracking-wide">
            {claim.status}
          </Text>
        </View>
      )}
    </View>
  );
}

export default ExpenseCard;

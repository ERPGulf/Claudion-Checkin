import React from "react";
import { TouchableOpacity, Text, ActivityIndicator } from "react-native";
import { COLORS } from "../../constants";

export default function SubmitButton({
  title = "Submit",
  loading = false,
  onPress,
  disabled,
  style,
}) {
  const isDisabled = loading || disabled;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[
        {
          backgroundColor: isDisabled ? "#9ca3af" : "#16a34a",
          padding: 14,
          borderRadius: 12,
          alignItems: "center",
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.white} />
      ) : (
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

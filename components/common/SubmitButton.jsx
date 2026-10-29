import { t, useTranslation } from '../../localization';
import React from "react";
import { TouchableOpacity, ActivityIndicator } from 'react-native';
import Text from '../../localization/LocalizedText';
import { COLORS } from "../../constants";

export default function SubmitButton({
  title = t("Submit"),
  loading = false,
  onPress,
  disabled,
  style,
}) {
  const { isRTL, direction } = useTranslation();
  const isDisabled = loading || disabled;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      // The spinner replaces the label, so name the button explicitly.
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
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

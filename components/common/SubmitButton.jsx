import React from "react";
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "../../constants";

export default function SubmitButton({
  title = "Submit",
  loading = false,
  onPress,
  disabled,
  style,
  textStyle,
  gradientColors = ["#77224C", "#8E273B"],
  paddingHorizontal = 20,
  borderRadius = 12,
  height = 48, // ✅ default height
}) {
  const isDisabled = loading || disabled;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[{ borderRadius, overflow: "hidden" }, style]}
    >
      <LinearGradient
        colors={isDisabled ? ["#9ca3af", "#9ca3af"] : gradientColors}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          height, // ✅ control height from outside
          paddingHorizontal,
          alignItems: "center",
          justifyContent: "center",
        }}
        
      >
        
        {loading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={[styles.text, textStyle]}>{title}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: {
    color: COLORS.white,
    fontWeight: "500",
    fontSize: 22, // ✅ default for all buttons
  },
});

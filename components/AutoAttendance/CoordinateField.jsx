/* eslint-disable react/prop-types */
import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';

/**
 * A numeric field for the manual geofence override.
 *
 * Same container language as the date/time fields on Attendance Request — label
 * above, recessed surface, hairline border, 16pt radius — so the two forms read
 * as one system. Left-aligned rather than the classic screen's right-aligned
 * text, because a coordinate is read from its first digits.
 *
 * `editable` is passed straight through and also drives the styling, so a field
 * that cannot be typed into looks like one. The keyboard type, autoCorrect and
 * the disabled rule are unchanged from the classic InputRow.
 */
function CoordinateField({ label, value, onChangeText, editable = true, hint }) {
  const { colors } = useAppTheme();

  return (
    <View style={{ minWidth: 0 }}>
      <Text
        style={{
          ...TYPO.caption,
          color: colors.textSecondary,
          marginBottom: SPACING.xs,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType="numeric"
        autoCorrect={false}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={{
          ...TYPO.body,
          color: editable ? colors.textPrimary : colors.textMuted,
          minHeight: 48,
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.sm,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          backgroundColor: colors.surfaceSecondary,
        }}
      />

      {!!hint && (
        <Text
          style={{
            ...TYPO.caption2,
            color: colors.textMuted,
            marginTop: SPACING.xs,
          }}
        >
          {hint}
        </Text>
      )}
    </View>
  );
}

export default CoordinateField;

/* eslint-disable react/prop-types */
import React from 'react';
import { View, Text } from 'react-native';
import { RADIUS } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { getInitials } from '../../utils/textDirection';

/**
 * Initials avatar. No image source exists in Redux today, so this renders
 * initials on a tinted surface; pass `children` to slot in an <Image> later
 * without touching call sites.
 */
function Avatar({ name, size = 44, style, children }) {
  const { colors } = useAppTheme();
  const initials = getInitials(name);

  return (
    <View
      accessible
      accessibilityLabel={name ? `Profile: ${name}` : 'Profile'}
      style={[
        {
          width: size,
          height: size,
          borderRadius: RADIUS.pill,
          backgroundColor: colors.accentSurface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children || (
        <Text
          allowFontScaling={false}
          style={{
            fontSize: Math.round(size * 0.38),
            fontWeight: '700',
            color: colors.primary2,
          }}
        >
          {initials || '·'}
        </Text>
      )}
    </View>
  );
}

export default Avatar;

/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from '../common/PressableScale';
import StatusBadge from './StatusBadge';

/**
 * A card whose body folds away behind its header.
 *
 * Built for the developer tools, which are the bulk of this screen's height but
 * matter to almost nobody opening it — collapsed by default, so the page starts
 * at the part users actually came for.
 *
 * Only the chevron is animated, and only its rotation, so it runs on the native
 * driver. The body mounts and unmounts rather than animating its height: an
 * Animated height needs a measured value, and measuring a body that contains
 * text inputs and a variable-length log is where collapse animations start
 * jumping. See the notes on LayoutAnimation if a height transition is wanted.
 *
 * `accessibilityState.expanded` is what tells a screen reader this is a
 * disclosure rather than a link.
 */
function CollapsibleCard({
  icon,
  title,
  subtitle,
  badgeLabel,
  badgeTone = 'neutral',
  defaultExpanded = false,
  children,
  style,
}) {
  const { colors, isDark } = useAppTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const spin = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(spin, {
      toValue: expanded ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [expanded, spin]);

  return (
    <View
      style={[
        {
          backgroundColor: colors.cardBackground,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          ...(isDark ? null : SHADOWS.card),
        },
        style,
      ]}
    >
      <PressableScale
        onPress={() => setExpanded((prev) => !prev)}
        scaleTo={0.99}
        hitSlop={0}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        accessibilityHint={expanded ? 'Collapses this section' : 'Expands this section'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 56,
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.md,
        }}
      >
        {!!icon && (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.iconBackground,
              marginEnd: SPACING.md,
            }}
          >
            <Ionicons name={icon} size={ICON.sm} color={colors.textPrimary} />
          </View>
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ ...TYPO.headline, color: colors.textPrimary }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {!!subtitle && (
            <Text
              style={{ ...TYPO.caption, color: colors.textMuted }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {!!badgeLabel && (
          <StatusBadge
            tone={badgeTone}
            label={badgeLabel}
            style={{ marginStart: SPACING.sm }}
          />
        )}

        <Animated.View
          style={{
            marginStart: SPACING.sm,
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '180deg'],
                }),
              },
            ],
          }}
        >
          <Ionicons
            name="chevron-down"
            size={ICON.md}
            color={colors.textMuted}
          />
        </Animated.View>
      </PressableScale>

      {expanded && (
        <>
          <View style={{ height: 1, backgroundColor: colors.dividerSubtle }} />
          <View
            style={{
              paddingHorizontal: SPACING.md,
              paddingTop: SPACING.md,
              paddingBottom: SPACING.md,
            }}
          >
            {children}
          </View>
        </>
      )}
    </View>
  );
}

export default CollapsibleCard;

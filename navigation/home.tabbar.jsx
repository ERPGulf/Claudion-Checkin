/* eslint-disable react/prop-types */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chat, Home, HomeLegacy, Profile } from '../screens';
import { COLORS, ICON, LAYOUT, RADIUS, SHADOWS } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
// TEMPORARY: New Home Experience experiment — remove with the feature.
import useHomeExperience from '../hooks/useHomeExperience';

const TabStack = createBottomTabNavigator();

const { tabBarContentHeight: CONTENT_HEIGHT, tabBarPillSize: PILL } = LAYOUT;

/** Pre-redesign tab bar geometry, kept for the experiment's OFF state. */
const LEGACY_BAR_HEIGHT = 70;
const LEGACY_ICON_SIZE = 30;

const TABS = [
  { name: 'home', icon: 'home', label: 'Home' },
  { name: 'chat', icon: 'chatbubble-ellipses', label: 'Chat' },
  { name: 'profile', icon: 'person', label: 'Profile' },
];

/**
 * Active tab: brand-tinted pill + filled glyph. Inactive: outline glyph in
 * `textSecondary`, no background.
 *
 * `tabBarIconStyle` sizes the wrapper to exactly PILL×PILL, so this fills its
 * container with `100%` rather than a fixed value. That matters: React
 * Navigation's own wrapper is 31×28, and a larger pill overflows it — which
 * makes the active background look oversized and the glyphs look off-centre.
 *
 * This renders twice per tab, once with `focused: true` and once with `false`
 * (BottomTabItem stacks both copies and toggles their opacity), so it must be
 * cheap and must not hold state.
 */
function TabIcon({ name, focused }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        borderRadius: RADIUS.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colors.accentSurface : 'transparent',
      }}
    >
      <Ionicons
        name={focused ? name : `${name}-outline`}
        size={ICON.lg}
        color={focused ? colors.primary2 : colors.textSecondary}
      />
    </View>
  );
}

function modernScreenOptions(insets, colors, isDark) {
  return {
    tabBarActiveTintColor: colors.primary2,
    tabBarInactiveTintColor: colors.textSecondary,
    headerShown: false,
    tabBarShowLabel: false,
    tabBarStyle: {
      // Docked to the bottom edge, not gutter-inset. A gutter-inset bar needs a
      // blur or scrim behind it, otherwise scrolling cards show through the gap
      // below and beside it and read as a bug.
      position: 'absolute',
      // `start`/`end`, not `left`/`right`: BottomTabBar's own base style sets
      // `start: 0, end: 0`, and Yoga gives the logical properties precedence,
      // so left/right here would be silently ignored.
      start: 0,
      end: 0,
      bottom: 0,
      // getTabBarHeight() returns this number verbatim, so it must be the bar's
      // *total* height for useBottomTabBarHeight() to be accurate.
      height: CONTENT_HEIGHT + insets.bottom,
      paddingBottom: insets.bottom,
      paddingTop: 0,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      backgroundColor: colors.surfaceElevated,
      // A shadow over a near-black page is invisible, so in dark mode the top
      // edge is drawn with a hairline instead.
      ...(isDark
        ? {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.cardBorder,
          }
        : { borderTopWidth: 0, ...SHADOWS.floating }),
    },
    tabBarItemStyle: {
      height: CONTENT_HEIGHT,
      // BottomTabItem's base style is `justifyContent: 'flex-start'`, which
      // packs the icon against the top of the item. Centre it.
      justifyContent: 'center',
      paddingVertical: 0,
    },
    tabBarIconStyle: {
      width: PILL,
      height: PILL,
    },
  };
}

/**
 * TEMPORARY — the tab bar as it was before the redesign. Always light: the
 * legacy Home screen has no dark palette, and useAppTheme() forces light
 * whenever the experiment is off, so this never renders on a dark page.
 *
 * The legacy Home reserves a hardcoded 68pt of bottom padding for a 70pt bar, so
 * the two have to travel together; pairing the new Home with this bar (or vice
 * versa) leaves the content either clipped or floating.
 */
function legacyScreenOptions() {
  return {
    tabBarActiveTintColor: COLORS.primary,
    headerShown: false,
    tabBarShowLabel: false,
    tabBarStyle: {
      position: 'absolute',
      height: LEGACY_BAR_HEIGHT,
      paddingBottom: 0,
      backgroundColor: 'white',
    },
  };
}

function HomeTabGroup() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  // TEMPORARY: New Home Experience experiment. When removing, delete this line
  // and inline `modernScreenOptions(...)` / `Home` / `<TabIcon />` below.
  const { enabled: newHomeEnabled } = useHomeExperience();

  const screenOptions = newHomeEnabled
    ? modernScreenOptions(insets, colors, isDark)
    : legacyScreenOptions();

  const components = {
    home: newHomeEnabled ? Home : HomeLegacy,
    chat: Chat,
    profile: Profile,
  };

  const renderIcon = icon =>
    function TabBarIcon({ focused, color }) {
      return newHomeEnabled ? (
        <TabIcon name={icon} focused={focused} />
      ) : (
        <Ionicons
          name={focused ? icon : `${icon}-outline`}
          size={LEGACY_ICON_SIZE}
          color={color}
        />
      );
    };

  return (
    <TabStack.Navigator screenOptions={() => screenOptions}>
      {TABS.map(tab => (
        <TabStack.Screen
          key={tab.name}
          name={tab.name}
          component={components[tab.name]}
          options={{
            tabBarAccessibilityLabel: tab.label,
            tabBarIcon: renderIcon(tab.icon),
          }}
        />
      ))}
    </TabStack.Navigator>
  );
}

export default HomeTabGroup;

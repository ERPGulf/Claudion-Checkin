import React from 'react';
import { AccessibilityInfo, Animated, AppState } from 'react-native';
import { act, cleanup, render, renderHook } from '@testing-library/react-native';

let mockReducedMotion = false;
let mockFocused = true;
jest.mock('../hooks/useReducedMotion', () => ({
  __esModule: true,
  default: () => mockReducedMotion,
}));
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: require('../constants').COLORS, isDark: false }),
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('expo-image', () => ({ Image: require('react-native').View }));
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: require('react-native').Text }));
jest.mock('../components/Welcome/SignInOptions', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text>Sign in options</Text> };
});

import { SkeletonBlock, useSkeletonPulse } from '../components/common/Skeleton';
import ExpenseSkeleton from '../components/ExpenseClaim/ExpenseSkeleton';
import HistorySkeleton from '../components/AttendanceHistory/HistorySkeleton';
import DetailSkeleton from '../components/ShortcutDetails/DetailSkeleton';
import NotificationSkeleton from '../components/Notifications/NotificationSkeleton';
import QrSkeleton from '../components/MyQrCode/QrSkeleton';
import WelcomeScreenModern from '../screens/WelcomeScreenModern';

const useRealReducedMotion = jest.requireActual('../hooks/useReducedMotion').default;
const animations = [];
const listeners = new Set();
let appSubscription;
let previousAppState;

const animation = () => ({ start: jest.fn(), stop: jest.fn() });
const composite = children => ({
  start: jest.fn(() => children.forEach(child => child.start())),
  stop: jest.fn(() => children.forEach(child => child.stop())),
});

beforeEach(() => {
  mockReducedMotion = false;
  mockFocused = true;
  animations.length = 0;
  listeners.clear();
  previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  appSubscription = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    listeners.add(callback);
    return { remove: () => { appSubscription(); listeners.delete(callback); } };
  });
  jest.spyOn(Animated, 'timing').mockImplementation(animation);
  jest.spyOn(Animated, 'delay').mockImplementation(animation);
  jest.spyOn(Animated, 'sequence').mockImplementation(composite);
  jest.spyOn(Animated, 'parallel').mockImplementation(composite);
  jest.spyOn(Animated, 'loop').mockImplementation(() => {
    const loop = animation();
    animations.push(loop);
    return loop;
  });
});

afterEach(() => {
  cleanup();
  AppState.currentState = previousAppState;
  jest.restoreAllMocks();
});

function PulseSample() {
  return <SkeletonBlock width={80} height={12} opacity={useSkeletonPulse()} />;
}

describe('loading motion', () => {
  it.each([
    ['shared block', PulseSample],
    ['expense', ExpenseSkeleton],
    ['attendance history', HistorySkeleton],
    ['document details', DetailSkeleton],
    ['notifications', NotificationSkeleton],
    ['QR code', QrSkeleton],
  ])('keeps %s placeholders visible without scheduling a loop under reduced motion', (_, Component) => {
    mockReducedMotion = true;
    const view = render(<Component />);
    expect(view.toJSON()).not.toBeNull();
    expect(animations).toHaveLength(0);
  });

  it('stops a running pulse when reduced motion changes, resumes and cleans up', () => {
    const view = render(<PulseSample />);
    expect(animations).toHaveLength(1);
    expect(animations[0].start).toHaveBeenCalledTimes(1);
    expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true, duration: 700 }));

    mockReducedMotion = true;
    view.rerender(<PulseSample />);
    expect(animations[0].stop).toHaveBeenCalledTimes(1);
    expect(animations).toHaveLength(1);

    mockReducedMotion = false;
    view.rerender(<PulseSample />);
    expect(animations).toHaveLength(2);
    expect(animations[1].start).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(animations[1].stop).toHaveBeenCalledTimes(1);
  });
});

describe('retained Welcome screen', () => {
  it('parks all six decorative loops on blur and resumes only when focused', () => {
    const view = render(<WelcomeScreenModern />);
    expect(animations).toHaveLength(6);
    animations.forEach(loop => expect(loop.start).toHaveBeenCalledTimes(1));

    mockFocused = false;
    view.rerender(<WelcomeScreenModern />);
    animations.forEach(loop => expect(loop.stop).toHaveBeenCalledTimes(1));
    expect(view.getByText('Sign in options')).toBeTruthy();

    mockFocused = true;
    view.rerender(<WelcomeScreenModern />);
    expect(animations).toHaveLength(12);
    animations.slice(6).forEach(loop => expect(loop.start).toHaveBeenCalledTimes(1));
    view.unmount();
    animations.slice(6).forEach(loop => expect(loop.stop).toHaveBeenCalledTimes(1));
    expect(appSubscription).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('stops decorative loops in background and waits for focus before resuming', () => {
    const view = render(<WelcomeScreenModern />);
    expect(animations).toHaveLength(6);
    act(() => listeners.forEach(callback => callback('background')));
    animations.forEach(loop => expect(loop.stop).toHaveBeenCalledTimes(1));

    mockFocused = false;
    view.rerender(<WelcomeScreenModern />);
    act(() => listeners.forEach(callback => callback('active')));
    expect(animations).toHaveLength(6);

    mockFocused = true;
    view.rerender(<WelcomeScreenModern />);
    expect(animations).toHaveLength(12);
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it('waits for the app to become active before scheduling decorative loops', () => {
    AppState.currentState = 'inactive';
    const view = render(<WelcomeScreenModern />);
    expect(animations).toHaveLength(0);
    act(() => listeners.forEach(callback => callback('active')));
    expect(animations).toHaveLength(6);
    view.unmount();
    animations.forEach(loop => expect(loop.stop).toHaveBeenCalledTimes(1));
  });

  it('schedules no decorative loops when reduced motion is enabled', () => {
    mockReducedMotion = true;
    render(<WelcomeScreenModern />);
    expect(animations).toHaveLength(0);
  });
});

describe('system reduced-motion lifecycle', () => {
  it('reads the OS preference, handles changes and removes its subscription', async () => {
    let settingChanged;
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, callback) => {
      expect(event).toBe('reduceMotionChanged');
      settingChanged = callback;
      return { remove };
    });
    const hook = renderHook(useRealReducedMotion);
    await act(async () => {});
    expect(hook.result.current).toBe(true);
    act(() => settingChanged(false));
    expect(hook.result.current).toBe(false);
    hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

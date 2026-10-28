/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useReducedMotion from '../../hooks/useReducedMotion';
import { useFeatureEnabled } from '../../hooks/useFeatureSettings';
import { selectIsLoggedIn } from '../../redux/Slices/AuthSlice';
import {
  GEOTAGGING,
  selectAutoAttendanceConfigured,
  selectAutoAttendanceScope,
} from '../../redux/Slices/AutoAttendanceSlice';
import { isOfflineSyncUnsupported } from '../../services/offline/offlineCapability';
import {
  describeLocationAccessSteps,
  setLocationAccessExplainer,
} from '../../utils/autoAttendance';
import { ATTENDANCE_FEATURES } from '../../utils/featureSettings';
import ActionButton from '../common/ActionButton';

// iOS cannot present a modal over another one (a screen's sheet, an alert): the
// presentation fails silently, and the permission flow would wait on it forever.
const SHOW_TIMEOUT_MS = 3000;

// Warnings-only (1) is reachable only from the Profile preview: the backend
// defines no warning behaviour for it, so employees are never shown it.
const COPY = {
  [GEOTAGGING.ALL_ACTIONS]: {
    title: 'Make attendance easier',
    description: 'Your employer has turned on automatic attendance. This app uses your location to record your attendance at your assigned workplace, even when the app is closed or not in use.',
    benefits: [
      {
        key: 'arrive',
        icon: 'enter-outline',
        title: 'Checked in as you arrive',
        description: 'At your assigned workplace, without opening the app.',
      },
      {
        key: 'leave',
        icon: 'exit-outline',
        title: 'Checked out as you leave',
        description: 'Recorded as you leave your assigned workplace.',
      },
    ],
    footnote: 'Without it, you check in and out yourself. Battery saving can delay automatic attendance. You can change access at any time in Settings.',
  },
  [GEOTAGGING.WARNINGS_ONLY]: {
    title: 'Enable location-based attendance',
    description: "Location access helps the app remind you about attendance and warn you when you're near or outside your assigned workplace. It never checks you in or out.",
    benefits: [
      {
        key: 'guidance',
        icon: 'navigate-outline',
        title: 'Attendance guidance',
        description: "See whether you're at your assigned workplace.",
      },
      {
        key: 'warnings',
        icon: 'notifications-outline',
        title: 'Warnings and reminders',
        description: "When you're near or outside your workplace.",
      },
      {
        key: 'manual',
        icon: 'hand-left-outline',
        title: 'You stay in control',
        description: 'You check in and out yourself, as usual.',
      },
    ],
    footnote: 'Attendance is never recorded automatically. You can change access at any time in Settings.',
  },
};

// Only while automatic punches can queue for this account: the employer's
// switch is on and the server is not known to lack the endpoint.
const OFFLINE_BENEFIT = {
  key: 'offline',
  icon: 'cloud-offline-outline',
  title: "Kept when you're offline",
  description: "Sent once you're back online.",
};

function Row({ icon, title, description, hint }) {
  const { colors } = useAppTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${description}${hint ? ` ${hint}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: SPACING.lg }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: RADIUS.sm,
          borderWidth: 1,
          borderColor: colors.accentBorder,
          backgroundColor: colors.accentSurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginEnd: SPACING.md,
        }}
      >
        <Ionicons name={icon} size={ICON.sm} color={colors.accentText} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>{title}</Text>
        <Text
          style={{
            ...TYPO.subhead,
            fontWeight: '400',
            color: colors.textSecondary,
            marginTop: 2,
          }}
        >
          {description}
        </Text>
        {hint ? (
          <Text style={{ ...TYPO.subhead, color: colors.textPrimary, marginTop: SPACING.xs }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The explanation shown before any system location prompt: Google Play's
 * prominent disclosure for background location, and the pre-alert screen
 * Apple's guidelines describe. Registered with utils/autoAttendance, so sign-in
 * onboarding and the screen's "Grant location access" share it.
 *
 * Full screen because Continue leads through up to two system prompts (and, on
 * Android 11+, a settings page), and it stays up behind them so each appears
 * over the step that describes it. On iOS, Continue is the only way on: Apple
 * rules out leaving a pre-alert screen without seeing the system alert, which
 * has its own "Don't Allow". Android adds Not now, and Back means the same —
 * Google Play does not let navigating away count as consent.
 */
export default function LocationAccessExplainer() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const offlineEnabled = useFeatureEnabled(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE);
  // The account an explanation may be shown for: signed in, with automatic
  // attendance configured by the employer.
  const scope = useSelector((state) => (
    selectIsLoggedIn(state) && selectAutoAttendanceConfigured(state)
      ? selectAutoAttendanceScope(state)
      : null
  ));
  const [request, setRequest] = useState(null);
  // Kept after the request settles, so the modal's exit animation has content.
  const [content, setContent] = useState({ mode: GEOTAGGING.ALL_ACTIONS, steps: [] });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ scope, request });

  useEffect(() => {
    latest.current = { scope, request };
  });

  useEffect(() => {
    const explain = (access, proceed, { mode = GEOTAGGING.ALL_ACTIONS, preview = false } = {}) =>
      new Promise((resolve, reject) => {
        const open = latest.current.request;
        // A preview never takes over an explanation waiting for an answer; a
        // real one replaces a preview.
        if (open && (preview || !open.preview)) {
          resolve(null);
          return;
        }
        open?.resolve(null);
        const steps = describeLocationAccessSteps(access);
        setContent({
          mode,
          steps: mode === GEOTAGGING.ALL_ACTIONS ? steps : steps.filter((step) => step.key !== 'background'),
        });
        // A replaced preview leaves the modal up, so it is not shown again.
        if (!open) setShown(false);
        setRequest({ scope: latest.current.scope, proceed, resolve, reject, preview });
      });
    const unregister = setLocationAccessExplainer(explain);
    return () => {
      unregister();
      latest.current.request?.resolve(null);
    };
  }, []);

  const settle = useCallback((answer) => {
    request?.resolve(answer);
    setRequest(null);
  }, [request]);

  // Closed unanswered when the account or the employer's configuration changes
  // under it (a preview has neither), or when it could not be shown. Not while
  // the system prompts it started are up: the flow ends when they do.
  useEffect(() => {
    if (!request || busy) return undefined;
    if (!request.preview && (!scope || request.scope !== scope)) {
      settle(null);
      return undefined;
    }
    if (shown) return undefined;
    const timer = setTimeout(() => settle(null), SHOW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [request, busy, scope, shown, settle]);

  const onContinue = () => {
    const current = request;
    setBusy(true);
    current.proceed()
      .then(current.resolve, current.reject)
      .finally(() => {
        setBusy(false);
        setRequest(null);
      });
  };

  const { mode, steps } = content;
  // Mounted above the ErrorBoundary: an unknown mode must not take the app down.
  const copy = COPY[mode] ?? COPY[GEOTAGGING.ALL_ACTIONS];
  const benefits = mode === GEOTAGGING.ALL_ACTIONS && offlineEnabled && !isOfflineSyncUnsupported()
    ? [...copy.benefits, OFFLINE_BENEFIT]
    : copy.benefits;

  return (
    <Modal
      testID="location-access-explainer"
      visible={!!request}
      animationType={reduceMotion ? 'fade' : 'slide'}
      statusBarTranslucent
      navigationBarTranslucent
      onShow={() => setShown(true)}
      // Android's Back; iOS offers no gesture that reaches this.
      onRequestClose={() => {
        if (!busy) settle(false);
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.surfaceSecondary,
          paddingTop: insets.top,
          paddingStart: insets.left,
          paddingEnd: insets.right,
        }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.xl,
            paddingBottom: SPACING.xl,
          }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 56,
              height: 56,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: colors.accentBorder,
              backgroundColor: colors.accentSurface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="location-outline" size={ICON.xl} color={colors.accentText} />
          </View>
          <Text
            accessibilityRole="header"
            style={{ ...TYPO.title2, color: colors.textPrimary, marginTop: SPACING.lg }}
          >
            {copy.title}
          </Text>
          <Text style={{ ...TYPO.body, color: colors.textSecondary, marginTop: SPACING.sm }}>
            {copy.description}
          </Text>

          {benefits.map(({ key, ...benefit }) => <Row key={key} {...benefit} />)}

          {steps.length ? (
            <Text
              accessibilityRole="header"
              style={{ ...TYPO.title3, color: colors.textPrimary, marginTop: SPACING.xxl }}
            >
              You&apos;ll be asked for
            </Text>
          ) : null}
          {steps.map(({ key, ...step }) => <Row key={key} {...step} />)}

          <Text style={{ ...TYPO.caption, color: colors.textMuted, marginTop: SPACING.xl }}>
            {copy.footnote}
          </Text>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.md,
            paddingBottom: Math.max(insets.bottom, SPACING.lg),
          }}
        >
          <ActionButton
            label="Continue"
            variant="filled"
            size="lg"
            loading={busy}
            disabled={busy}
            onPress={onContinue}
          />
          {Platform.OS === 'ios' ? null : (
            <ActionButton
              label="Not now"
              variant="outline"
              size="lg"
              disabled={busy}
              onPress={() => settle(false)}
              style={{ marginTop: SPACING.sm }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

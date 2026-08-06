import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CameraView } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { ICON, RADIUS, SHADOWS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useQrScanner from "../hooks/useQrScanner";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import PressableScale from "../components/common/PressableScale";
import { ScanOverlay } from "../components/QrScan";

/** Back chip over the live preview: dark enough to read on any picture. */
const OVERLAY_CHIP = "rgba(0,0,0,0.45)";

/**
 * The scanner's own backdrop, and the one colour this screen paints from its very
 * first frame to its last. Not a palette token on purpose — see <ScanOverlay>: the
 * backdrop here is a camera picture, not a themed surface.
 */
const CHASSIS = "#000000";

/**
 * How long to wait for the push animation before starting the camera, when the
 * navigator's `transitionEnd` never arrives — a screen that mounts already
 * focused, or a navigator that does not emit it. The event wins in the normal
 * case; this only exists so a missing event cannot leave the preview off forever.
 */
const TRANSITION_FALLBACK_MS = 400;

/** Cross-fade from the warming-up cover to the live picture. */
const PREVIEW_FADE_MS = 220;

/**
 * Modern Scan QR Code.
 *
 * Presentation only. Every behaviour — the permission request, the base64/utf8
 * decode, the field parser, the AsyncStorage write, the four dispatches, the
 * `navigate("login")`, the gallery fallback through `Camera.scanFromURLAsync`,
 * and the `alert()` failure paths — lives in hooks/useQrScanner.js, a faithful
 * lift of what QrScanLegacy still runs inline. The `<CameraView>` below is handed
 * the same `barcodeScannerSettings`, the same `onBarcodeScanned` and the same
 * `type` as the classic screen, so the decoder sees exactly what it saw before.
 *
 * The classic screen was a full-bleed camera with a thin white border floating
 * across the top of it, a giant ghost QR glyph in the middle, a decorative white
 * box that did nothing, and two stacked brand-coloured buttons at the bottom —
 * which is why it read as unfinished. This is the pattern every real scanner uses
 * instead:
 *
 *   1. the live preview, full width, under a transparent header,
 *   2. a dark mask with one clear rounded window and breathing corner brackets,
 *      so it is obvious where to point,
 *   3. the alignment hint directly under the window,
 *   4. the actions grouped on a themed sheet attached to the bottom edge, rather
 *      than two buttons floating on the picture.
 *
 * Why a sheet and not buttons over the camera: <ActionButton> resolves its fill
 * from the palette, and over a camera that fails in one mode or the other — a
 * `filled` button is near-black on light, which disappears into the mask, and an
 * `outline` button is near-black on dark, which does the same. On its own themed
 * surface the shared button is correct in both palettes with no override, and the
 * grouping is what fixes the "disconnected" bottom button.
 */
function QrScanModern() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const {
    requestPermission,
    initializing,
    denied,
    scanned,
    handleBarCodeScanned,
    scanAgain,
    pickImage,
  } = useQrScanner();

  /**
   * Whether this screen is showing its scanner chassis rather than an ordinary app
   * surface — which is true for everything except the refusal state.
   *
   * Deliberately **not** `!initializing && !denied`. Keying the chrome on
   * "the preview is up" made the header restyle itself the moment the permission
   * answer landed: opaque themed bar with a dark title for one frame, then
   * transparent with a white one. The screen is black from its first frame now, so
   * the overlay chrome is correct from the first frame too, and the happy path
   * sets the header exactly once.
   */
  const overlayChrome = !denied;

  /* ---------- When to start the camera ---------- */
  /**
   * Not during the push. Opening a camera session is native work on the UI thread,
   * and mounting <CameraView> in the same beat as the navigation animation is what
   * made "Get Started" feel like it stuck — the animation and the session start
   * compete, and the animation loses. Waiting for `transitionEnd` moves that cost
   * to after the screen has landed, which costs the preview a couple of hundred
   * milliseconds and buys back a clean transition.
   *
   * Nothing visible waits on this: the mask, the frame, the hint and the action
   * sheet are all up during the push, so the preview fills in behind a window that
   * is already there instead of the screen changing shape.
   *
   * Latched, never reset: on a return from `login` the pop re-emits the event, but
   * if it ever did not, resetting would leave the scanner dead. `isFocused` is
   * what handles that trip.
   */
  const [transitionSettled, setTransitionSettled] = useState(false);

  useEffect(() => {
    const settle = () => setTransitionSettled(true);

    const unsubscribe = navigation.addListener("transitionEnd", settle);
    const timer = setTimeout(settle, TRANSITION_FALLBACK_MS);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [navigation]);

  /**
   * `isFocused` as well, so the session is torn down when `login` is pushed over
   * this screen after a good scan. The screen stays mounted underneath, and a
   * camera left decoding there is both a live camera nobody is looking at and a
   * decoder still firing `onBarcodeScanned` at the QR code that is presumably
   * still in frame.
   */
  const previewMounted =
    transitionSettled && isFocused && !initializing && !denied;

  /* ---------- Warming-up cover ---------- */
  /* The cover is what the screen shows in the window until the sensor delivers a
     picture. It fades out over the preview rather than the preview fading in:
     Android backs the preview with a SurfaceView, whose alpha is not reliably
     composited, so the thing that animates has to be the ordinary view on top. */
  const [coverVisible, setCoverVisible] = useState(true);
  const coverOpacity = useRef(new Animated.Value(1)).current;

  const handleCameraReady = useCallback(() => {
    Animated.timing(coverOpacity, {
      toValue: 0,
      duration: PREVIEW_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setCoverVisible(false);
    });
  }, [coverOpacity]);

  // Re-arm whenever the preview goes away, so a return trip warms up rather than
  // showing a stale frame of nothing.
  useEffect(() => {
    if (previewMounted) return;
    coverOpacity.setValue(1);
    setCoverVisible(true);
  }, [previewMounted, coverOpacity]);

  /**
   * Same route, same title, same `goBack` — restyled, and transparent while the
   * preview is live.
   *
   * This is the one modern screen that cannot use useModernScreenHeader(): that
   * hook paints an opaque `surfaceSecondary` bar, and a solid light strip sitting
   * above a live camera feed is precisely the seam that made this screen look
   * half-finished. The two non-camera states are ordinary app surfaces, so they
   * take the themed bar the rest of the app uses.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerShown: true,
      headerTitle: "Scan QR Code",
      headerTitleAlign: "center",
      headerTransparent: overlayChrome,
      headerStyle: {
        backgroundColor: overlayChrome ? "transparent" : colors.surfaceSecondary,
      },
      // Light glyphs over the preview — see the <StatusBar> note below for why
      // this is the Android half of a two-platform fix.
      //
      // ANDROID ONLY, and it must stay that way: on iOS react-native-screens
      // asserts that `UIViewControllerBasedStatusBarAppearance` is YES before it
      // will honour this, and this project's Info.plist has it false, so setting
      // it there is not "ignored" — it throws and redboxes the screen. Flipping
      // the plist is not the fix either: it is a native change, so it cannot ship
      // over OTA (the crash would), and it would hand status-bar ownership to
      // every view controller in the app to solve one screen.
      ...(Platform.OS === "android"
        ? { statusBarStyle: overlayChrome || isDark ? "light" : "dark" }
        : null),
      // Over the preview the chrome is fixed white, for the same reason the mask
      // is: the backdrop is a camera picture, not a themed surface.
      headerTitleStyle: {
        color: overlayChrome ? "#FFFFFF" : colors.textPrimary,
      },
      headerTintColor: overlayChrome ? "#FFFFFF" : colors.textPrimary,
      headerLeft: () => (
        <PressableScale
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          style={{
            width: 36,
            height: 36,
            borderRadius: RADIUS.pill,
            backgroundColor: overlayChrome
              ? OVERLAY_CHIP
              : colors.iconBackground,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="chevron-back"
            size={ICON.md}
            color={overlayChrome ? "#FFFFFF" : colors.textPrimary}
          />
        </PressableScale>
      ),
    });
  }, [
    navigation,
    overlayChrome,
    colors.surfaceSecondary,
    colors.textPrimary,
    colors.iconBackground,
    isDark,
  ]);

  /* ---------- Permission refused ---------- */
  /* The shared <EmptyState>, in a <Card>, exactly as the modern error states on
     My QR Code and Home. `Try again` re-runs the same `requestPermission()` the
     mount effect already calls — no new permission mechanics. Android stops
     showing the dialog after a hard denial, which is why the copy names Settings
     rather than pretending the button is always enough. */
  if (denied) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
        edges={["bottom", "left", "right"]}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: SPACING.lg,
          }}
        >
          <Card>
            <EmptyState
              icon="camera-outline"
              title="Camera access needed"
              description="Scanning your setup QR code needs the camera. Allow access, or turn it on for Claudion in your device Settings."
              actionLabel="Try again"
              onActionPress={requestPermission}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- Scanner ---------- */
  /* One tree for the whole scanner, from mount to live preview, rather than a
     loading screen that is later replaced by a scanner.

     It used to be two: an `initializing` branch on `surfaceSecondary` — #F4F5F7 in
     light mode — and then this one on black. Since the permission answer is always
     at least a tick away, every single push painted the near-white screen first
     and swapped to black a frame or two later. That flash, plus the header
     restyling itself in the same beat, was the blink; the chassis being constant
     is what removes it. The permission state now decides only whether the camera
     is mounted, not what the screen looks like. */
  return (
    <View style={{ flex: 1, backgroundColor: CHASSIS }}>
      {/* The iOS half of the status-bar fix. The app's <ThemedStatusBar> resolves
          to dark glyphs in light mode, which are invisible over a camera picture
          (measured: nothing brighter than luminance 40 in the clock area).
          Each platform needs a different mechanism, and each one is inert on the
          other:
            iOS     — this element works, because `UIViewControllerBasedStatus-
                      BarAppearance` is false, so RN drives the app-level API.
            Android — this is a silent no-op, because the activity is edge-to-edge
                      and StatusBarModule refuses imperative changes ("Ignored
                      status bar change, current activity is edge-to-edge"); the
                      `statusBarStyle` route option above is what applies there.
          Mounted unconditionally rather than behind a Platform check: it costs
          nothing on Android and it pops its own stack entry on unmount, which is
          what restores the previous style when the scanner closes. */}
      <StatusBar style="light" />

      <View style={{ flex: 1 }}>
        {/* Scanner props verbatim from the classic screen — the decoder sees what
            it always saw. What changed is when this mounts and what it is painted
            over, not how it reads. */}
        {previewMounted && (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarCodeScanned}
            onCameraReady={handleCameraReady}
            style={StyleSheet.absoluteFill}
            type="back"
          />
        )}

        {/* Warming up: the same spinner and caption the old loading screen had,
            kept inside the scanner instead of standing in for it. */}
        {coverVisible && (
          <Animated.View
            pointerEvents="none"
            style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: CHASSIS,
              alignItems: "center",
              justifyContent: "center",
              opacity: coverOpacity,
            }}
          >
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text
              style={{
                ...TYPO.subhead,
                fontWeight: "400",
                color: "#FFFFFF",
                opacity: 0.7,
                marginTop: SPACING.md,
              }}
            >
              Preparing camera…
            </Text>
          </Animated.View>
        )}

        <ScanOverlay />
      </View>

      {/* ---------- Actions ---------- */}
      {/* Pulled up over the preview by its own radius, so the rounded top edge
          reveals the picture behind it and the sheet reads as attached to the
          scanner rather than parked under it. */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: RADIUS.xxl,
          borderTopRightRadius: RADIUS.xxl,
          marginTop: -RADIUS.xxl,
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.lg,
          paddingBottom: Math.max(insets.bottom, SPACING.lg),
          ...(isDark
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.cardBorder,
              }
            : SHADOWS.floating),
        }}
      >
        {/* Only reachable when a code was read but rejected — a good scan leaves
            for `login`. So this is the recovery action, and it is the primary one
            while it is on screen. Replaces "TAP TO SCAN AGAIN". */}
        {scanned && (
          <ActionButton
            label="Scan again"
            icon="scan-outline"
            size="lg"
            onPress={scanAgain}
            style={{ marginBottom: SPACING.sm }}
          />
        )}

        {/* The classic "SELECT FROM PHOTOS" button, same `pickImage` action.
            `outline`, not `filled`: pointing the camera is the primary path on a
            scanner, and a filled button here would outrank it. */}
        <ActionButton
          label="Choose from Photos"
          icon="images-outline"
          variant="outline"
          size="lg"
          onPress={pickImage}
        />
      </View>
    </View>
  );
}

export default QrScanModern;

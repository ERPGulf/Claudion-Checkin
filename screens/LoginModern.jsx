import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Formik } from "formik";
import { BUILD_TAG, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useLogin from "../hooks/useLogin";
import useReducedMotion from "../hooks/useReducedMotion";
import ActionButton from "../components/common/ActionButton";
import FormField from "../components/common/FormField";
import { BrandMark } from "../components/Welcome";
import { GreetingCard } from "../components/Login";

/** The wordmark, small. Branding on a login form is a signature, not a hero. */
const HEADER_MARK_WIDTH = 124;

/**
 * The rhythm the screen is laid out on, top to bottom. Named rather than typed in
 * at each margin so the intervals stay comparable — the classic screen's spacing
 * was 20 / 5 / 10 / 12 / 14 with a `justifyContent: "space-between"` doing the
 * rest, which is why nothing on it looked related to anything else.
 */
const GAP_AFTER_HEADER = SPACING.xxl; // 24
const GAP_AFTER_CARD = SPACING.xxl; // 24
const GAP_AFTER_FIELD = SPACING.xl; // 20
const GAP_BETWEEN_BUTTONS = SPACING.md; // 12

/** Entrance. Same primitive and roughly the same timings as the welcome screen. */
const RISE_PX = 12;
const FADE_MS = 380;
const LIFT_MS = 320;
const LIFT_DELAY_MS = 110;

/**
 * Modern Login.
 *
 * Presentation only. Every behaviour — the Yup schema, the three AsyncStorage
 * reads, the "QR code not scanned" guard, `generateToken`, the `employee_id`
 * write, `setSignIn`, the post-login notification fetch, all four toasts and the
 * error mapping through `getLoginErrorMessage` — lives in hooks/useLogin.js, a
 * faithful lift of what LoginLegacy still runs inline. <Formik> is still the form
 * state, with the same `initialValues` and the same `validationSchema`, and the
 * QR button still does nothing but `navigate("Qrscan")`.
 *
 * Nothing here decides when the user is logged in. `selectIsLoggedIn` swaps the
 * navigator, so a successful login has no navigation call on this screen — see
 * the note in useLogin.
 *
 * What changed is the layout, and the problem it had was hierarchy rather than
 * colour. The classic screen was a 260pt near-black slab, then a bare label and
 * input, then a `space-between` that threw the two buttons to the bottom of the
 * viewport — so the password field floated alone in the middle of the page, the
 * action you needed was as far from it as the screen allowed, and the two buttons
 * were the same size and weight as each other. The order is unchanged; the
 * distances are what carry meaning now:
 *
 *   wordmark → 24 → greeting → 24 → password → 20 → Login → 12 → Scan QR
 *   → flexible → build stamp
 *
 * The 20 under the field and the 12 between the buttons are the whole fix: the
 * primary action sits with the field it submits, the secondary sits with the
 * primary as an alternative to it, and the only elastic space left is beneath
 * them, where stretching costs nothing. On a short screen the slack is zero and
 * the layout simply ends above the stamp.
 *
 * The two buttons are the shared <ActionButton> at one size and two variants:
 * `accent` for Login, the brand teal, and `outline` for the QR route. That is
 * the pair the rest of the app uses for "the thing to do" and "the other way",
 * and it is what stops the QR button reading as a second primary — the classic
 * screen gave it a full-weight border in the same brand colour at the same
 * height, which is a co-equal button by every visual measure.
 *
 * A <ScrollView> with `flexGrow: 1` inside a <KeyboardAvoidingView>: at default
 * type it behaves as a flex column and the spacer distributes the slack; with the
 * keyboard up, or at large accessibility type, the content scrolls rather than
 * being compressed or clipped. `keyboardShouldPersistTaps="handled"` so the first
 * tap on Login submits instead of only dismissing the keyboard.
 */
function LoginModern() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();

  const { loginSchema, initialValues, isLoading, handleLogin, fullname } =
    useLogin();

  /* ---------- Entrance ---------- */
  /* Core Animated on the native driver, the app's one animation primitive. Two
     values off one idea: the card fades in, the actions arrive just behind it. */
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Straight to the settled state. For some people motion is nausea.
      fade.setValue(1);
      lift.setValue(1);
      return undefined;
    }

    const animation = Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 1,
        duration: LIFT_MS,
        delay: LIFT_DELAY_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, fade, lift]);

  const liftStyle = {
    opacity: lift,
    transform: [
      {
        translateY: lift.interpolate({
          inputRange: [0, 1],
          outputRange: [RISE_PX, 0],
        }),
      },
    ],
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom", "left", "right"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // Same platform split the classic screen used: iOS needs the padding
          // behaviour, Android resizes the window itself.
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: SPACING.lg,
              paddingTop: SPACING.xl,
              paddingBottom: SPACING.lg,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Formik
              initialValues={initialValues}
              validationSchema={loginSchema}
              onSubmit={({ password }) => handleLogin(password)}
            >
              {({
                values,
                errors,
                touched,
                handleChange,
                handleSubmit,
                setFieldTouched,
                isValid,
              }) => (
                <>
                  {/* Slack above the block, and the smaller share of it — the
                      form sits just above centre rather than pinned to the top
                      with the whole lower half empty, which is the same void the
                      classic screen had, only underneath instead of inside. It
                      collapses to nothing first: with the keyboard up or at large
                      type, this is the space that goes. */}
                  <View style={{ flex: 0.55 }} />

                  {/* ---------- Header ---------- */}
                  {/* The mark alone, small and start-aligned. No "Login" title:
                      the greeting card underneath already says who is signing in,
                      and the button says what pressing it does. */}
                  <Animated.View style={{ opacity: fade, alignItems: "center" }}>
                    <BrandMark width={HEADER_MARK_WIDTH} />
                  </Animated.View>

                  <View style={{ height: GAP_AFTER_HEADER }} />

                  {/* ---------- Greeting ---------- */}
                  <Animated.View style={{ opacity: fade }}>
                    <GreetingCard name={fullname} />
                  </Animated.View>

                  <View style={{ height: GAP_AFTER_CARD }} />

                  {/* ---------- Password ---------- */}
                  {/* The shared field, with its own reveal toggle and its own
                      error line — the same control Expense Claims, Leave and
                      Complaints use, so the focus ring, the radius and the fill
                      are not this screen's invention. */}
                  <Animated.View style={{ opacity: fade }}>
                    <FormField
                      label="Password"
                      icon="lock-closed-outline"
                      placeholder="Enter password"
                      value={values.password}
                      onChangeText={handleChange("password")}
                      onBlur={() => setFieldTouched("password")}
                      secureTextEntry
                      disabled={isLoading}
                      returnKeyType="go"
                      onSubmitEditing={handleSubmit}
                      textContentType="password"
                      autoComplete="password"
                      autoCapitalize="none"
                      errorText={
                        touched.password && errors.password
                          ? errors.password
                          : undefined
                      }
                      accessibilityLabel="Password"
                      accessibilityHint="Enter the password for your Claudion account"
                    />
                  </Animated.View>

                  <View style={{ height: GAP_AFTER_FIELD }} />

                  {/* ---------- Actions ---------- */}
                  <Animated.View style={liftStyle}>
                    {/* Same guard as the classic screen — `!isValid || isLoading`
                        — and the shared button's own `loading` state replaces the
                        hand-rolled <ActivityIndicator> swap.

                        Deliberately **not** `elevated`, unlike the welcome CTA.
                        `elevated` is `SHADOWS.card`, which carries `elevation`,
                        and this button lives inside the entrance wrapper below —
                        an <Animated.View> with a `translateY`. A transformed
                        ancestor promotes the subtree to a hardware layer on
                        Android, and the child's elevation shadow is then drawn to
                        that layer's rectangular bounds instead of following the
                        corner radius: measured on device as a hard-edged grey
                        plate whose square corners poke out past the rounded
                        button. The welcome CTA is elevated and clean because its
                        wrapper animates opacity only.

                        No loss. The accent button is already the
                        highest-contrast thing on the screen; the shadow was
                        doing nothing the colour was not. */}
                    <ActionButton
                      label="Login"
                      icon={I18nManager.isRTL ? "arrow-back" : "arrow-forward"}
                      variant="accent"
                      size="lg"
                      loading={isLoading}
                      disabled={!isValid || isLoading}
                      onPress={handleSubmit}
                    />

                    <View style={{ height: GAP_BETWEEN_BUTTONS }} />

                    {/* The classic "Rescan QR Code", same destination. `outline`
                        so it reads as the alternative route rather than a second
                        primary, and disabled mid-submit so a tap cannot navigate
                        out from under an in-flight login. */}
                    <ActionButton
                      label="Scan QR Code"
                      icon="qr-code-outline"
                      variant="outline"
                      size="lg"
                      disabled={isLoading}
                      onPress={() => navigation.navigate("Qrscan")}
                    />
                  </Animated.View>

                  {/* The larger share of the slack, so the block lands above the
                      optical centre rather than dead in the middle. Everything
                      between the header and the buttons is spaced by intent; the
                      two spacers are the only places the layout may stretch. */}
                  <View style={{ flex: 1, minHeight: SPACING.xl }} />

                  {/* Same OTA build stamp, same source of truth. */}
                  <Text
                    style={{
                      ...TYPO.caption2,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {BUILD_TAG}
                  </Text>
                </>
              )}
            </Formik>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export default LoginModern;

# DESIGN.md — Claudion Checkin UI guide

How to build a new screen or feature that looks like the rest of the app. Written for
coding agents: give it this file along with the task, e.g.

> Read `DESIGN.md` and follow it exactly. Build a modern "Overtime request" screen:
> a form with date, hours and reason, submit to `…`. Reuse `components/common/`.

Everything here describes code that already exists. When this file and the code
disagree, the code wins; [constants/theme.js](constants/theme.js) and the
docblocks in [components/common/](components/common/) are the source of truth.

---

## 1. Hard rules

1. **Colours come from `useAppTheme()`.** `const { colors, isDark } = useAppTheme();`
   Never import `COLORS` in new UI because it pins the screen to light mode. Never write a hex
   literal. No new colours: if a token doesn't exist, use the nearest one that does.
2. **Size values come from tokens.** `SPACING`, `RADIUS`, `TYPO`, `ICON`, `SHADOWS`, `LAYOUT`
   from `../constants`. Spread type: `style={{ ...TYPO.headline, color: colors.textPrimary }}`.
3. **Inline style objects, not NativeWind.** Modern screens and every `components/common/`
   primitive use `style={{…}}` with tokens. `className` is legacy-only.
4. **Compose from [components/common/](components/common/)** before writing any new view.
   If two screens would need the same new piece, add it to `components/common/`.
5. **Everything tappable is a `PressableScale`**, or a component built on it
   (`ActionButton`, `SettingsRow`, `FeatureTile`…). Icon-only buttons need `accessibilityLabel`.
6. **Shadows are light-mode only:** `...(isDark ? null : SHADOWS.card)`. In dark mode,
   the border and the lighter surface show elevation.
7. **Screens are presentation only.** State, validation, payloads and API calls live in
   `hooks/useFeature.js` + `utils/` + `services/api/`. The screen renders what the hook returns.
8. **No new native dependencies** (gradients, blur, svg, reanimated worklets…). The app
   ships JS over OTA, and an OTA bundle that imports a missing native module crashes every
   existing install. Build depth from views (§8).
9. **Icons are Ionicons**, and new icons use the outline style (`wallet-outline`). Other
   families only through a component's `iconFamily` prop.

---

## 2. Colour tokens

Light and dark palettes live in [constants/theme.js](constants/theme.js) (`COLORS`,
`DARK_COLORS`). Use them by **role**:

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page background (behind cards) | `surfaceSecondary` | `#F4F5F7` | `#0B0B0D` |
| Card / sheet surface | `cardBackground` | `#FFFFFF` | `#1B1B1F` |
| Raised bar (tab bar) | `surfaceElevated` | `#FFFFFF` | `#1B1B1F` |
| Neutral chip behind an icon, recessed fill | `iconBackground` | `#F1F2F5` | `#26262B` |
| Loading placeholder | `skeleton` | `#EDEEF1` | `#26262B` |
| 1px card hairline | `cardBorder` | `#EBECF0` | `#2A2A30` |
| In-card divider | `dividerSubtle` | `#F0F1F4` | `#232328` |
| Titles, values | `textPrimary` | `#110E11` | `#F5F5F7` |
| Labels, body | `textSecondary` | `#55555F` | `#B4B4BE` |
| Meta, timestamps, hints | `textMuted` | `#7C7C88` | `#8A8A96` |
| Primary button fill / label | `buttonFill` / `buttonFillText` | near-black / white | near-white / near-black |
| Brand CTA fill / label | `accentFill` / `accentFillText` | `#084048` / white | `#20E0B0` / near-black |
| Decorative brand accent | `primary2` | `#084048` | `#20E0B0` |

**Status triads.** Every tone has three matching colours: `${tone}Surface`,
`${tone}Border`, `${tone}Text`. Use all three together so a tinted box stays readable.
Tones: `success`, `warning`, `error`, `info`, `accent` (brand teal), `neutral`
(no judgement: unknown, other, draft).

```js
backgroundColor: colors[`${tone}Surface`],
borderColor: colors[`${tone}Border`], borderWidth: 1,
color: colors[`${tone}Text`],
```

**Brand.** The brand is the two-tone teal from the Claudion wordmark: deep ink
`#084048` and mint `#20E0B0`. Light mode reads with the ink and tints with the mint.
Dark mode swaps to the mint. Use `primary2` / `accent*` tokens and never a raw teal.
`BRAND_TEAL_MINT` is exported **only** for a surface that is dark in both palettes (the
Profile hero). The old orange `#F87627` is retired and should not come back.

**Traps:**
- `primary` is near-black in both palettes. Never use it as a fill because it disappears on
  a dark card. Use `buttonFill`.
- Need translucency (glow, scrim)? Use `withAlpha(colors.x, 0.1)` from
  [utils/color.js](utils/color.js), not a new rgba colour.

---

## 3. Spacing, radius, type, icons

**Spacing** uses an 8pt grid (`SPACING`): `xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32`.

| Use | Value |
| --- | --- |
| Screen side margin | `SPACING.lg` (16) |
| Top of scroll content | `SPACING.md` |
| Gap between stacked cards | `SPACING.md` |
| Gap between Home-level sections | `SPACING.xxl` |
| Card inner padding | `SPACING.lg` (`<Card padded>`), or `SPACING.md` for compact cards |
| Icon ↔ text gap | `SPACING.sm` (`marginEnd`) |

**Radius** (`RADIUS`): `sm 8` icon chips, badges · `md 12` buttons, tiles · `lg 16` inner
cards, banners · `xl 20` cards, module cards · `xxl 24` · `pill 999`.

**Type** (`TYPO`). Each entry is size, line height and weight:

| Token | Size/LH/Weight | Use for |
| --- | --- | --- |
| `title1` | 28/34/700 | The one hero figure on a card (an amount, a clock) |
| `title2` | 22/28/700 | Large headings (rare) |
| `title3` | 17/22/600 | Section headers, summary values, `lg` button labels |
| `headline` | 15/20/600 | Card titles, `md` button labels |
| `body` | 15/21/400 | Paragraph text |
| `subhead` | 13/18/500 | Banner text, secondary lines, text actions |
| `caption` | 12/16/500 | Field labels, meta, subtitles |
| `caption2` | 11/14/500 | Badges, tile labels |

Put `fontVariant: ['tabular-nums']` on figures that appear in columns.

**Icons** (`ICON`): `sm 16` inline chevrons, badges · `md 20` card-header icons, back
button · `lg 24` feature tiles, bell · `xl 28`.

---

## 4. Screen templates

### Stack screen (anything pushed from Home), such as forms and detail screens

The navigator hides headers globally, so a modern stack screen turns one on with
`useModernScreenHeader(title)`. That gives the themed bar, centred title and round back
chip. Because the header handles the top inset, the `SafeAreaView` excludes `top`.
[screens/Complaints.jsx](screens/Complaints.jsx) is the reference implementation.

```jsx
import React from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SPACING } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useOvertimeRequest from "../hooks/useOvertimeRequest"; // all logic lives here
import ModuleCard from "../components/common/ModuleCard";
import FormField from "../components/common/FormField";
import ActionButton from "../components/common/ActionButton";
import StatusBanner from "../components/common/StatusBanner";

function OvertimeRequest() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Overtime request");
  const { reason, setReason, loading, submit } = useOvertimeRequest();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: SPACING.xl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <ModuleCard
          dense
          icon="time-outline"
          title="Overtime details"
          subtitle="Tell us when and why"
          style={{ marginBottom: SPACING.md }}
        >
          <FormField
            label="Reason *"
            value={reason}
            onChangeText={setReason}
            multiline
            align="auto"
          />
        </ModuleCard>

        <ActionButton
          label="Submit request"
          icon="paper-plane-outline"
          variant="filled"
          size="lg"
          elevated
          loading={loading}
          disabled={loading}
          onPress={submit}
        />

        <StatusBanner
          tone="info"
          title="What happens next"
          message="Your manager reviews the request. You'll be notified of the decision."
          style={{ marginTop: SPACING.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

export default OvertimeRequest;
```

### Tab screen (Home, Chat, Profile)

Tab screens have **no header**. Pad the top with `useSafeAreaInsets().top` and reserve
room for the floating tab bar at the bottom:
`paddingBottom: insets.bottom + LAYOUT.tabBarContentHeight + SPACING.xxl`.
See [screens/Home.jsx](screens/Home.jsx).

### List screen

Handle four states, and keep **error** separate from **empty** because they need
different responses from the user. [screens/AttendanceHistory.jsx](screens/AttendanceHistory.jsx) is the reference.

| State | Render |
| --- | --- |
| Loading | A skeleton with the same geometry as the real rows (not a centred spinner) |
| Error | `StatusBanner tone="error"` + `<Card><EmptyState … actionLabel="Try again" /></Card>` |
| Empty | `<Card><EmptyState icon=… title=… description=… /></Card>` |
| Data | `FlatList`/`SectionList`, `paddingHorizontal: SPACING.lg`, memoised rows |

- Fade once from skeleton to content (`Animated.timing` 220ms, native driver). Don't stagger rows,
  because recycled rows re-animate on scroll.
- Themed pull-to-refresh:
  `<RefreshControl tintColor={colors.textMuted} colors={[colors.primary2]} progressBackgroundColor={colors.cardBackground} />`
- Footer: `ActivityIndicator color={colors.textMuted}` while paging, then a
  `caption`/`textMuted` "That's everything".
- For a group of rows in one card, put the border and shadow on the wrapper and let each
  row round its own outer corners (`position: first | middle | last | single`).
  **Do not** use `overflow: 'hidden'` (§8).

---

## 5. Component catalogue

Import each component from its own file (`../components/common/Card`), the same way the
existing screens do. `Skeleton` and `RecordCard` are not in the `index.js` barrel.

| Need | Use | Notes |
| --- | --- | --- |
| Any elevated surface | `Card` | Radius 20, hairline, light-only shadow. `padded` gives a 16pt inset. Omit it when children are full-bleed `SettingsRow`s. |
| Titled section with icon header | `ModuleCard` | `dense` for long or short forms. Chevron shows only when `onPress` is passed. |
| Section label over content | `SectionHeader` | `title3`, optional `subtitle`, optional teal text action. |
| Settings / property list rows | `SettingsRow` + `RowDivider` | 60pt rows, icon chip, trailing `children` / `value` / chevron. `size="comfortable"` for read-only property lists. |
| Grid of feature shortcuts | `FeatureTile` | `columns={4}`. Labels wrap themselves, so don't hand-split them. |
| Submitted record (date range + fields) | `RecordCard` | `rows=[{label, value}]`, pre-formatted by the caller. Empty values are dropped. |
| Status pill | `StatusBadge` | `tone`, `label`, optional `icon` or `dot`. |
| Inline callout / notice | `StatusBanner` | `tone`, `title`, `message`. Left-aligned. Icon defaults per tone. |
| Nothing-here / error body | `EmptyState` | Inside a `Card`. Optional CTA. `compact` inside smaller cards. |
| Loading placeholder | `SkeletonBlock` + `useSkeletonPulse()` | One pulse per skeleton, passed to every block so they breathe in step. |
| Button | `ActionButton` | See variants below. `md` 48pt in cards, `lg` 54pt for the screen's main commitment. |
| Text input | `FormField` | Label above, 56pt (`compact` 48). `multiline`/`minLines`, `secureTextEntry`, `errorText`, `align="right"` for amounts, `align="auto"` for free text. |
| Date / time field | `PickerField` | Presentation only. The screen owns the `DateTimePicker`. `active` while open. Pair two with `fitsTwoColumns(width)`. |
| Single choice from a list | `OptionSheet` | Replaces `@react-native-picker/picker`. Value is the untouched server string. |
| Custom sheet | `BottomSheet` | Backdrop, handle, header, swipe-to-dismiss, themed. |
| Attachment | `UploadField` + `AttachmentSheet` | Wire to `useAttachmentPicker`. `optional={false}` for required files. |
| Search | `SearchBar` + `SearchCount` | Clear button appears only when there is text. |
| Initials avatar | `Avatar` | Handles Arabic names. |
| Bell with unread count | `NotificationButton` | |

**ActionButton variants.** Use at most one `filled` per screen.

| Variant | Meaning |
| --- | --- |
| `filled` | The screen's primary action. Inverts per palette. |
| `accent` | Brand teal as the action itself, only when the screen exists for one invitation (Login). At most one per screen. |
| `outline` | Secondary action. |
| `tinted` + `tone` | Semantic. `tone="error"` is only for truly destructive actions. Ending a shift is routine, not destructive. |

Don't colour buttons by outcome: the label says what the action does.

**Do not use in new UI:** `SubmitButton` (legacy green), `components/attachment/AttachmentBottomSheet`
(legacy sheet with a hardcoded palette), `@react-native-picker/picker`, anything in `*Legacy.jsx`.

---

## 6. Patterns and conventions

**Card intro block.** To open a form screen with a short "what this is" card, use a 32×32
`RADIUS.sm` chip in the accent triad (`accentSurface` fill, `accentBorder` hairline,
`accentText` `ICON.sm` glyph), then a `headline` title and a `caption`/`textMuted`
description. See the top of [screens/Complaints.jsx](screens/Complaints.jsx).

**Forms.**
- Put labels above fields. Mark required fields with ` *` in the label. Validation runs in the hook
  on press (Alerts/`errorText`), and the button disables only while a request is in flight.
- Keep the submit button inline at the end of the content, not pinned. A `StatusBanner tone="info"`
  "What happens next" follows it.
- Use `ModuleCard dense` for short forms and to keep long forms from being mostly chrome.

**Status → tone mapping.** Define one map in the domain util and render it with
`StatusBadge`. Unknown statuses go to `neutral`, never `error`.
Pattern: [utils/expenseClaims.js](utils/expenseClaims.js).

```js
approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
pending:  { label: 'Pending',  tone: 'warning', icon: 'time-outline' },
rejected: { label: 'Rejected', tone: 'error',   icon: 'close-circle' },
draft:    { label: 'Draft',    tone: 'neutral', icon: 'create-outline' },
```

**Copy.**
- Labels are sentence case ("Attendance request", not "Attendance Request").
  `__tests__/featureLabels.test.js` enforces this for menu labels.
- Never show raw server or Frappe error text to employees. Use a plain sentence and log the rest.
- A disabled feature is described as availability ("Your administrator has turned this off"),
  not as a permission failure.
- Left-align multi-line text. Centre only one-line titles and empty states.

**RTL / Arabic.** User and server strings are often Arabic. Use `resolveTextAlign(value)`
from [utils/textDirection.js](utils/textDirection.js), or `FormField align="auto"`.
Use logical properties (`marginStart/End`, `paddingStart/End`, `start/end`) rather than left/right.

**Motion.** Use the core `Animated` API with `useNativeDriver: true`. Reanimated is installed but
unused, so don't start using it. Press feedback comes from `PressableScale`. Loops (spinners,
pulses) should respect reduce-motion (see `useReduceMotion` in
[OfflineBanner.jsx](components/common/OfflineBanner.jsx)). Short one-shot transitions
stay.

**Accessibility.**
- Screen and section titles get `accessibilityRole="header"`.
- A card that represents one record is a single screen-reader stop with a combined
  `accessibilityLabel`, but put that on an **inner View**, not on `<Card>` (§8).
- Tap targets are at least 44pt. Pass `accessibilityState={{ disabled, busy }}` where it applies.

---

## 7. Wiring a new feature into the app

1. **Screen:** `screens/Feature.jsx`, exported from [screens/index.js](screens/index.js).
2. **Route:** register in [navigation/app-navigator.jsx](navigation/app-navigator.jsx).
   Route names are human strings with spaces (`"Overtime request"`); match them exactly
   everywhere.
3. **Server-gated?** Wrap it with `withFeatureGate("Route name", Screen)` inside the `gated` memo
   and add the route → flag entry to `ROUTE_FEATURES` in
   [utils/featureSettings.js](utils/featureSettings.js). The Home tile then hides itself too.
4. **Home tile:** add to `HR_FEATURES` in [components/Home/YourLavas.jsx](components/Home/YourLavas.jsx)
   (sentence case, outline Ionicon, `nav` = route name). If it should be pinnable, add it to
   `QUICK_ACCESS_OPTIONS` in [utils/quickAccess.js](utils/quickAccess.js) with the **same label**.
5. **Legacy:** new features are modern-only, with no `*Legacy.jsx` twin. When the "New Home
   Experience" toggle is off, `useAppTheme()` forces the light palette, so token-based screens
   still render correctly. Don't restyle existing `*Legacy.jsx` files.
6. **Navigating from outside React** (notifications, services): use `navigateSafely`
   from [navigation/rootNavigation.js](navigation/rootNavigation.js).

---

## 8. Platform pitfalls we have already hit

Each of these shipped or nearly shipped as a bug. Don't repeat them.

- **`overflow: 'hidden'` on Android** can drop every absolutely-positioned child, and it clips
  to the bounding rectangle rather than the rounded corner. On iOS it also removes the view's
  shadow. Keep decoration inside the bounds instead of clipping it.
- **No shadow on a container that wraps a focused `TextInput`.** It blurs the input the moment
  it focuses: the keyboard opens, then closes, and nothing types. This happens on **both**
  platforms, so an iOS-only gate is not a fix. Show focus with border → `textPrimary` and
  fill → `cardBackground`.
- **`accessible` on `<Card>` turns the card grey (#ECECEC) on Android.** Put
  `accessible` + `accessibilityLabel` on an inner View that paints nothing
  (see [components/Login/GreetingCard.jsx](components/Login/GreetingCard.jsx)).
- **Tab screens have no header.** A global overlay anchored at the top lands on Home's content.
  Anchor overlays to the bottom, above the tab bar, and check them on Home.
- **Status bar:** `ThemedStatusBar` follows the app theme. A per-screen override needs
  `statusBarStyle` in `setOptions` on **Android only** (it redboxes iOS) **plus**
  `<StatusBar>` from `expo-status-bar` for iOS. [screens/QrScanModern.jsx](screens/QrScanModern.jsx) is the example.
- **Logo:** use `components/Welcome/BrandMark.jsx`, which picks
  `assets/claudion-wordmark-light.png` or `-dark.png`. Never put `icon.png` on a themed page
  (it's an opaque white square), and never `tintColor` the two-tone mark.
- **Gradients / glows without native libs:** stack translucent views of one token with
  `withAlpha`, as in [components/Welcome/AccentHalo.jsx](components/Welcome/AccentHalo.jsx).
- **An Android screenshot doesn't verify iOS.** Check both platforms, in light **and** dark.

---

## 9. Tests

Add `__tests__/featureUi.test.jsx` following
[__tests__/complaintsUi.test.jsx](__tests__/complaintsUi.test.jsx): mock `useColorScheme`
to switch light/dark, stub `@expo/vector-icons`, `react-native-safe-area-context` and
`@react-navigation/native`, mock the service, and render the screen in both themes. Put the
hook's logic tests next to it. Run with `npx jest __tests__/featureUi.test.jsx`.

---

## 10. Done checklist

- [ ] No hex literals, no `COLORS` import, no `className`. Every colour comes from `useAppTheme()`.
- [ ] Spacing, radius, type and icons come from tokens. Side margin is `SPACING.lg`. Page background is `surfaceSecondary`.
- [ ] Built from `components/common/`. No re-implemented card, button, field, badge or sheet.
- [ ] Logic is in a hook/util/service. The screen only renders.
- [ ] Loading (skeleton), error, empty and data states are all handled, and error ≠ empty.
- [ ] Shadows are light-only. No `overflow: 'hidden'` on decorated views. No shadow around a focused input.
- [ ] One `filled` button at most. Sentence-case labels. No raw server errors shown.
- [ ] Route registered with the exact name, feature-gated if server-controlled, and a Home tile if needed.
- [ ] No new native dependency.
- [ ] UI test covers light and dark. Checked on Android **and** iOS, in both themes.

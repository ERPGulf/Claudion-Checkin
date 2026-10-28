# UI, accessibility and motion audit

Date: 2026-10-28. Applied skills: emil-design-eng, native-relevant apple-design principles, animate-expo, improve-animations and find-animation-opportunities. `DESIGN.md` remains the product's design authority.

## Confirmed findings and fixes

| ID / severity | Evidence / root cause | User impact and fix | Tests |
| --- | --- | --- | --- |
| F04 Medium | [Skeleton.jsx:26](../../components/common/Skeleton.jsx#L26); ExpenseSkeleton, HistorySkeleton, DetailSkeleton: independent infinite loops ignored reduced-motion preference | Static themed placeholders under reduced motion; all consumers reuse shared pulse implementation | motionLifecycle covers six consumers, setting changes, loop cleanup and accessibility subscription removal |
| F07 Medium | [HapticsMessage.js:3](../../utils/HapticsMessage.js#L3): native async feedback promises were discarded without rejection handlers | Optional haptic failure no longer escapes attendance/auth UI as an unhandled rejection; synchronous undefined return retained | hapticsMessage success/error/warning, rejected/synchronous native failures, one feedback per request, unknown type |
| F09 Medium | [useNotifications.js:64](../../hooks/useNotifications.js#L64), notification.service: success [] and failure [] were indistinguishable; hook kept previous list for every [] | Genuine empty success now clears the inbox; real failure retains saved data with warning or initial retry state. Opt-in strict service mode preserves legacy [] callers. Ignore stale/overlapping requests | notificationReadState and notificationsUi: empty, failed refresh, initial failure, race, invalidation, theme |
| F10 Medium | [useShortcutData.js:4](../../hooks/useShortcutData.js#L4), Shortcut1/2 detail renderers: catch swallowed failed fetch and rendered normal empty copy | Scoped error/retry state, missing-employee load completion, distinct error vs successful empty; modern/classic renderers share behavior | shortcutData and shortcutDetailsUi: rejection, retry/recovery, empty, stale result, light/dark/classic |

F05's Welcome visibility gates and F06's periodic work are detailed in the memory report. No new decorative animation or design system was added.

## Screen/design review

Reviewed shared pressables/buttons, cards, fields, picker/attachment sheets, loaders, toast, badges and errors; Welcome/Login/mobile steps; Home/Profile/settings; manual/photo/automatic attendance and history; notifications; employee records; leave, expense, loan, complaint, resignation and attendance requests; modern and legacy consumers. Screen inventory appears in report 02.

The modern paths generally already use role-based theme colors, shared spacing/type tokens, logical start/end spacing, outline icons, safe-area containers and reusable presentation primitives. Forms preserve dedicated hook/service ownership. Both modern and legacy routes remain registered with the same names and feature gates. No blanket restyling or cosmetic-only change was justified.

Existing error/banner/button primitives were reused for retry/warning states; user-visible copy does not show raw server errors. New feedback retains accessibility labels and themed colors. Automated rendering covers light/dark paths and classic record errors. These checks do not establish screen-reader announcements, focus order, text clipping or visual contrast on physical devices.

## Motion gate: considered and rejected

| Candidate | Frequency / purpose | Decision |
| --- | --- | --- |
| Additional tab/page transitions | Repeated peer navigation; platform already owns transitions | Reject: no useful new spatial information |
| Animated attendance totals/history values | Functional data employees read/act on | Reject: moving data would hinder reading |
| New looping offline/empty-state decoration | Persistent status, no additional state explanation | Reject: unnecessary continuous work |
| Shared press feedback | Frequent feedback already supplied by PressableScale | Retain existing subtle feedback; no second implementation |

The highest-value motion change was **stopping invisible work**, not adding an effect. Browser CSS/hover prescriptions and Reanimated/Expo Router migration defaults were not ported into this app. Native-driver transforms/opacity, existing durations and visual tokens remain.

## Remaining visual/device risks, not reproduced defects

- `screens/AttendanceRequest.jsx` lacks some automatic keyboard inset/dismissal options used by other modern forms. Confirm the submit area remains reachable with iOS keyboard, dynamic type and small screens before changing it.
- `components/common/RecordCard.jsx` has single-line values that may need flex/shrink constraints for extreme labels. A source observation alone does not prove measured overflow.
- Test Arabic/RTL, long names/labels, largest font sizes, reduced motion changed live, VoiceOver/TalkBack, sheet dismissal and keyboard focus on both platforms and themes.
- Gesture timing, blur cost, interruptibility feel and dropped frames require release-device traces. Simulator/unit results are not physical performance proof.

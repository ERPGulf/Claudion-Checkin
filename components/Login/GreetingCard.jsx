/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import { resolveTextAlign } from '../../utils/textDirection';
import Avatar from '../common/Avatar';
import Card from '../common/Card';

/**
 * Who is about to sign in, on the modern login screen.
 *
 * Replaces <WelcomeCard> for the modern UI only — the classic screen still
 * renders that one, untouched. What it replaces was a 260pt near-black slab with
 * "Login" centred in it, a 20pt gap, "Hey," and the name at 24pt beside a grey
 * circle. Three problems, and the height was only the obvious one:
 *
 *   1. it was a solid `COLORS.primary` block, which is the one thing the modern
 *      language does not do — every other surface in the app is a themed card
 *      with a hairline and a soft shadow, so this read as a leftover,
 *   2. it repeated the screen's own title inside itself,
 *   3. at 260pt it was the largest thing on a screen whose actual job is one
 *      password field, so the form looked like an afterthought under it.
 *
 * This is the same information — greeting, name, identity glyph — as a compact
 * row: <Avatar> with the person's initials, the greeting above the name, and one
 * line of reassurance under it. It comes out near 108pt against 260, and it is
 * built from the shared <Card>, so its radius, border, surface and elevation are
 * the same tokens as every card on Home, Profile and Expense Claims, in both
 * palettes.
 *
 * The name keeps the classic screen's Arabic handling, by the shared helper
 * rather than an inline regex: `resolveTextAlign` right-aligns a name in an RTL
 * script and leaves a Latin one alone. It is still allowed two lines and still
 * shrinks to fit, so a long name neither clips nor pushes the password field off
 * the screen.
 *
 * Announced as one item — but from the inner row, **not** from the <Card>.
 * Measured on device: `accessible` on the Card flattens its white background to
 * #ECECEC on Android, darker than the page it sits on, so the card reads as a
 * grey slab. Moving the grouping one level in keeps the single screen-reader stop
 * and gives the card its surface back. (The same prop is passed straight to
 * <Card> by <ExpenseHistoryCard> and <QrBadgeCard>, which have the same problem —
 * fixing it inside Card means wrapping its children, which would break the flex
 * and `alignItems` those two rely on, so it is worth doing on its own.)
 *
 * With no name — `Full_Name` is optional in the QR payload — the greeting becomes
 * the headline instead of captioning an empty line. "Welcome back, there" is not
 * a sentence worth shipping.
 */
function GreetingCard({ name, subtitle = 'Continue securely to your workspace.' }) {
  const { colors } = useAppTheme();

  const named = !!name;

  return (
    <Card padded>
      <View
        accessible
        accessibilityLabel={`Welcome back${named ? `, ${name}` : ''}. ${subtitle}`}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        <Avatar name={name} size={44} />

        {/* minWidth 0 so a long unbroken name shrinks this column instead of
            shoving the avatar out of the card. */}
        <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
          {named && (
            <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>
              Welcome back
            </Text>
          )}

          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            numberOfLines={2}
            style={{
              ...TYPO.title3,
              color: colors.textPrimary,
              textAlign: resolveTextAlign(name),
              marginTop: named ? 2 : 0,
            }}
          >
            {named ? name : 'Welcome back'}
          </Text>

          <Text
            numberOfLines={2}
            style={{
              ...TYPO.caption,
              fontWeight: '400',
              color: colors.textMuted,
              marginTop: SPACING.xs,
            }}
          >
            {subtitle}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export default GreetingCard;

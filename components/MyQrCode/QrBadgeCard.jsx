/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Avatar from '../common/Avatar';
import Card from '../common/Card';
import { resolveTextAlign } from '../../utils/textDirection';
import QrPlate from './QrPlate';

/**
 * The digital employee badge: the code on its white plate, a hairline, then the
 * identity it belongs to.
 *
 * Shaped like a wallet pass rather than a form card — the QR is the largest
 * thing on the screen and everything else is subordinate to it. The identity row
 * underneath is the shared <Avatar> (initials, the same one Home's welcome card
 * uses) beside the name already in Redux and the employee id the QR endpoint
 * returned. Neither is re-derived: `employee` is printed exactly as the server
 * sent it, in a tabular pill so it reads as a code rather than a sentence.
 *
 * The whole card is one accessibility node, so a screen reader announces "badge
 * for <name>, <id>" instead of walking an image, an avatar and two labels.
 */
function QrBadgeCard({ imageUrl, employee, fullname }) {
  const { colors } = useAppTheme();

  return (
    <Card
      style={{ padding: SPACING.lg, alignItems: 'center' }}
      accessible
      accessibilityLabel={`Employee badge${fullname ? ` for ${fullname}` : ''}${
        employee ? `, ${employee}` : ''
      }`}
    >
      <QrPlate uri={imageUrl} employee={employee} />

      <View
        style={{
          height: 1,
          alignSelf: 'stretch',
          backgroundColor: colors.dividerSubtle,
          marginVertical: SPACING.lg,
        }}
      />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
        }}
      >
        {/* Only when there is a name to draw initials from — `getInitials`
            returns '' for an empty one, and an avatar showing a placeholder dot
            reads as a failed image rather than as "no name on file". */}
        {!!fullname && <Avatar name={fullname} size={44} />}

        <View
          style={{
            flex: 1,
            minWidth: 0,
            marginStart: fullname ? SPACING.md : 0,
          }}
        >
          {!!fullname && (
            <Text
              numberOfLines={1}
              style={{
                ...TYPO.headline,
                color: colors.textPrimary,
                // Arabic names align to their own script, as on Home.
                textAlign: resolveTextAlign(fullname),
              }}
            >
              {fullname}
            </Text>
          )}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: fullname ? 4 : 0,
            }}
          >
            <Ionicons
              name="person-outline"
              size={ICON.sm}
              color={colors.textMuted}
            />
            <View
              style={{
                marginStart: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                paddingVertical: 2,
                borderRadius: RADIUS.pill,
                backgroundColor: colors.neutralSurface,
                borderWidth: 1,
                borderColor: colors.neutralBorder,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  ...TYPO.caption,
                  color: colors.textSecondary,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {employee || '—'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}

export default QrBadgeCard;

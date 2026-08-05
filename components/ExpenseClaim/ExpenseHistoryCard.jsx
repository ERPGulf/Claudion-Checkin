/* eslint-disable react/prop-types */
import React from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from '../common/Card';
import StatusBadge from '../common/StatusBadge';
import PressableScale from '../common/PressableScale';
import { resolveTextAlign } from '../../utils/textDirection';
import {
  describeClaimForA11y,
  describeExpenseStatus,
  expenseTypeIcon,
  formatExpenseAmount,
  formatExpenseDate,
  formatExpenseType,
  resolveAttachments,
} from '../../utils/expenseClaims';

/**
 * One submitted claim.
 *
 * Three bands, in the order the eye needs them: a header that says what kind of
 * expense this is and where it stands, the amount on its own line as the single
 * largest thing on the card, then a footer for the receipt behind a hairline.
 *
 * The amount is the hierarchy's anchor — title1 and tabular, so a column of
 * claims can be compared by running down the left edge. The type name sits at
 * headline above the date, which means the header never competes with it.
 *
 * The status is a tone-driven <StatusBadge> rather than the classic card's
 * hand-rolled pill, so "Approved" is the same green here as every other success
 * state in the app, and an unmapped status goes neutral instead of being styled
 * as an error.
 *
 * The footer only renders when the claim has a receipt: an empty "No attachment"
 * row on every claim without one would cost a band of height per card to say
 * nothing. Absence is reported to screen readers through the combined label
 * instead, where it is a fact rather than a layout.
 *
 * Presentation only. `Linking.openURL` on a receipt is the same call the classic
 * card made, and the URL is resolved from the same tenant `baseUrl`.
 */
function ExpenseHistoryCard({ claim, baseUrl = '', style }) {
  const { colors } = useAppTheme();

  const attachments = resolveAttachments(claim?.file_url, baseUrl);
  const { tone, label: statusLabel, icon: statusIcon } = describeExpenseStatus(
    claim?.status,
  );
  const typeLabel = formatExpenseType(claim?.expense_type);

  return (
    <Card
      style={[{ padding: SPACING.md }, style]}
      // One sentence per card, so a screen reader announces "Travel, 1,250.00,
      // 5 Aug 2026, Approved, 1 attachment" instead of six loose fragments.
      accessible
      accessibilityLabel={describeClaimForA11y(claim, attachments.length)}
    >
      {/* ---------- Header: what it was, and where it stands ---------- */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: RADIUS.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.iconBackground,
          }}
        >
          <Ionicons
            name={expenseTypeIcon(claim?.expense_type)}
            size={ICON.md}
            color={colors.textPrimary}
          />
        </View>

        <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.headline, color: colors.textPrimary }}
          >
            {typeLabel}
          </Text>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.caption, color: colors.textMuted }}
          >
            {formatExpenseDate(claim?.expense_date)}
          </Text>
        </View>

        {!!claim?.status && (
          <StatusBadge
            tone={tone}
            icon={statusIcon}
            label={statusLabel}
            style={{ marginStart: SPACING.sm }}
          />
        )}
      </View>

      {/* ---------- Amount ---------- */}
      <Text
        style={{
          ...TYPO.title1,
          color: colors.textPrimary,
          fontVariant: ['tabular-nums'],
          marginTop: SPACING.sm,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {formatExpenseAmount(claim?.amount)}
      </Text>

      {/* ---------- Description ---------- */}
      {!!claim?.description && (
        <Text
          numberOfLines={2}
          style={{
            ...TYPO.subhead,
            fontWeight: '400',
            color: colors.textSecondary,
            marginTop: 2,
            // Frappe descriptions are regularly Arabic; align to the script the
            // text actually contains rather than assuming Latin.
            textAlign: resolveTextAlign(claim.description),
          }}
        >
          {claim.description}
        </Text>
      )}

      {/* ---------- Receipt ---------- */}
      {attachments.length > 0 && (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: colors.dividerSubtle,
              marginTop: SPACING.md,
              marginBottom: SPACING.sm,
            }}
          />

          {attachments.map((file, index) => (
            <PressableScale
              key={file.key}
              onPress={() => Linking.openURL(file.url)}
              scaleTo={0.99}
              hitSlop={0}
              accessibilityRole="link"
              accessibilityLabel={`Open ${file.name}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 44,
                paddingHorizontal: SPACING.sm,
                borderRadius: RADIUS.md,
                backgroundColor: colors.surfaceSecondary,
                marginTop: index > 0 ? SPACING.xs : 0,
              }}
            >
              {file.isImage ? (
                <Image
                  source={{ uri: file.url }}
                  style={{ width: 28, height: 28, borderRadius: RADIUS.sm }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons
                  name="document-text-outline"
                  size={ICON.sm}
                  color={colors.textSecondary}
                />
              )}

              <Text
                numberOfLines={1}
                style={{
                  ...TYPO.caption,
                  flex: 1,
                  minWidth: 0,
                  marginStart: SPACING.sm,
                  color: colors.textSecondary,
                  textAlign: resolveTextAlign(file.name),
                }}
              >
                {file.name}
              </Text>

              <Ionicons
                name="open-outline"
                size={ICON.sm}
                color={colors.textMuted}
              />
            </PressableScale>
          ))}
        </>
      )}
    </Card>
  );
}

/**
 * Memoised because this is a FlatList row: the screen re-renders whenever a page
 * is revealed or a refresh lands, and without this every card already on screen
 * would re-render with it. The props are a claim object (stable identity — it
 * comes straight out of the query cache), a string and a module-level style
 * constant, so the default shallow comparison is enough.
 */
export default React.memo(ExpenseHistoryCard);
